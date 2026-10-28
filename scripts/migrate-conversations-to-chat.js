/**
 * One-time: move the old tour-page conversations into the chat (see utils/chatMigration.js).
 * Safe to run again; old records are kept. Uses DATABASE_DEV when NODE_ENV=development, otherwise DATABASE.
 *   NODE_ENV=development node scripts/migrate-conversations-to-chat.js
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', 'config.env') });
const { migrateConversations } = require('../utils/chatMigration');

const dev = process.env.NODE_ENV === 'development';
const uri = (dev ? process.env.DATABASE_DEV : process.env.DATABASE || '')
  .replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''))
  .replace('<db_password>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''));

(async () => {
  if (!uri) throw new Error('No database address in config.env');
  await mongoose.connect(uri);
  const { threads, messages, skipped } = await migrateConversations();
  console.log(`${dev ? 'plezar_dev' : 'plezar'}: moved ${threads} conversation(s) and ${messages} message(s) into the chat; skipped ${skipped} (agency or traveler gone).`);
  await mongoose.disconnect();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
