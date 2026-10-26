/**
 * One-time: give every account saved before multiple roles existed a `roles` list ([its role]).
 * Safe to run more than once. Uses DATABASE_DEV when NODE_ENV=development, otherwise DATABASE.
 *   NODE_ENV=development node scripts/migrate-user-roles.js
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', 'config.env') });

const dev = process.env.NODE_ENV === 'development';
const uri = (dev ? process.env.DATABASE_DEV : process.env.DATABASE || '')
  .replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''))
  .replace('<db_password>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''));

(async () => {
  if (!uri) throw new Error('No database address in config.env');
  await mongoose.connect(uri);
  const users = mongoose.connection.db.collection('users');
  const result = await users.updateMany(
    { $or: [{ roles: { $exists: false } }, { roles: { $size: 0 } }] },
    [{ $set: { roles: [{ $ifNull: ['$role', 'user'] }] } }]
  );
  await users.createIndex({ roles: 1 });
  console.log(`${dev ? 'plezar_dev' : 'plezar'}: gave ${result.modifiedCount} account(s) a roles list.`);
  await mongoose.disconnect();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
