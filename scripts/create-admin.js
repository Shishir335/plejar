/**
 * Create a master admin account, or reset the password of an existing one.
 *
 *   npm run create-admin          # production database (DATABASE)
 *   npm run create-admin -- --dev # development database (DATABASE_DEV)
 *
 * The password is typed at a hidden prompt and is never printed or stored in plain text.
 */
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', 'config.env') });
const User = require('../models/userModel');

const useDev = process.argv.includes('--dev');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
// Hide typed characters while asking for a password
// eslint-disable-next-line no-underscore-dangle
const writeOutput = rl._writeToOutput ? rl._writeToOutput.bind(rl) : null;
// eslint-disable-next-line no-underscore-dangle
rl._writeToOutput = text => {
  if (writeOutput && (!muted || text.includes('\n'))) writeOutput(muted ? '\n' : text);
};

const ask = (question, { hidden = false } = {}) =>
  new Promise(resolve => {
    rl.question(question, answer => {
      muted = false;
      resolve(answer.trim());
    });
    muted = hidden;
  });

const databaseUri = () => {
  const raw = useDev ? process.env.DATABASE_DEV : process.env.DATABASE;
  if (!raw) throw new Error(`${useDev ? 'DATABASE_DEV' : 'DATABASE'} is not set in config.env.`);
  return raw.replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''));
};

(async () => {
  try {
    console.log(`\nPlezar admin setup — ${useDev ? 'DEVELOPMENT (plezar_dev)' : 'PRODUCTION'} database\n`);
    await mongoose.connect(databaseUri(), { serverSelectionTimeoutMS: 10000 });

    const email = (await ask('Admin email: ')).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That is not a valid email address.');

    let user = await User.findOne({ email }).select('+password');
    if (user && user.role === 'agent') {
      throw new Error('This email belongs to a tour agency account. Use a different email for the admin.');
    }

    let name = user ? user.name : '';
    if (!user) {
      name = await ask('Your name: ');
      if (!name) throw new Error('Enter a name.');
    }

    const password = await ask('New password (min 8 characters, hidden): ', { hidden: true });
    if (password.length < 8) throw new Error('The password must be at least 8 characters.');
    const confirm = await ask('Confirm password (hidden): ', { hidden: true });
    if (password !== confirm) throw new Error('The two passwords do not match.');

    if (!user) {
      user = new User({ name, email, role: 'admin', authProvider: 'local' });
    }
    user.role = 'admin';
    user.password = password;
    user.confirmPassword = password;
    user.accountStatus = 'active';
    user.active = true;
    user.inviteToken = undefined;
    user.inviteExpires = undefined;
    await user.save();

    console.log(`\nDone. ${email} can now sign in at /admin with the password you just set.\n`);
  } catch (err) {
    console.error(`\nNot changed: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
    await mongoose.disconnect().catch(() => {});
  }
})();
