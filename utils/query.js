const mongoose = require('mongoose');

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pageParams = (query, defaultLimit = 20) => {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 100);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { page, limit, skip: (page - 1) * limit };
};

const paged = (total, { page, limit }) => ({ total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) });

const validId = id => mongoose.isValidObjectId(id);

// Mongoose casts an ID string for a normal query but not inside an aggregation pipeline
const toId = id => new mongoose.Types.ObjectId(String(id));

module.exports = { escapeRegex, pageParams, paged, validId, toId };
