const Setting = require('../models/settingModel');

// Settings change rarely and are read on every booking, so keep them for a short while in memory
const CACHE_MS = 30 * 1000;
const cache = new Map();

const getSetting = async (key, fallback) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const doc = await Setting.findOne({ key }).lean();
  const value = doc && doc.value !== undefined ? doc.value : fallback;
  cache.set(key, { value, at: Date.now() });
  return value;
};

const setSetting = async (key, value, userId) => {
  await Setting.findOneAndUpdate({ key }, { value, updatedBy: userId }, { upsert: true, new: true });
  cache.delete(key);
};

module.exports = { getSetting, setSetting };
