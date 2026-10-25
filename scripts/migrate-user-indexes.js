/**
 * Lets travelers sign up with only a mobile number: the unique index on users.email
 * becomes "unique among accounts that have an email". No account data is changed.
 *
 *   npm run migrate-user-indexes          # production database (DATABASE)
 *   npm run migrate-user-indexes -- --dev # development database (DATABASE_DEV)
 */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', 'config.env') });

const useDev = process.argv.includes('--dev');

const databaseUri = () => {
  const raw = useDev ? process.env.DATABASE_DEV : process.env.DATABASE;
  if (!raw) throw new Error(`${useDev ? 'DATABASE_DEV' : 'DATABASE'} is not set in config.env.`);
  return raw.replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''));
};

(async () => {
  try {
    console.log(`\nUsers index update — ${useDev ? 'DEVELOPMENT (plezar_dev)' : 'PRODUCTION'} database\n`);
    await mongoose.connect(databaseUri(), { serverSelectionTimeoutMS: 10000 });
    const users = mongoose.connection.db.collection('users');
    const indexes = await users.indexes();
    const onEmail = indexes.filter(i => Object.keys(i.key).length === 1 && i.key.email === 1);

    if (onEmail.length === 1 && onEmail[0].name === 'email_1' && onEmail[0].partialFilterExpression) {
      console.log('Already done: email is unique among accounts that have one.');
    } else {
      const blank = await users.countDocuments({ email: { $in: [null, ''] } });
      if (blank) throw new Error(`${blank} account(s) have an empty email. Fix them before running this.`);
      const dupes = await users.aggregate([{ $match: { email: { $type: 'string' } } }, { $group: { _id: '$email', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
      if (dupes.length) throw new Error(`${dupes.length} email(s) are used by more than one account. Fix them before running this.`);
      // MongoDB can't hold two indexes with the same spec, so the old one goes first (a moment without it)
      await Promise.all(onEmail.map(i => users.dropIndex(i.name)));
      await users.createIndex({ email: 1 }, { name: 'email_1', unique: true, partialFilterExpression: { email: { $type: 'string' } } });
      console.log('Done: email is now unique among accounts that have one.');
    }
    if (!indexes.find(i => i.name === 'phone_1')) {
      await users.createIndex({ phone: 1 }, { name: 'phone_1' });
      console.log('Added an index on phone for signing in with a mobile number.');
    }
  } catch (err) {
    console.error(`\nStopped: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
