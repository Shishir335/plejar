const Destination = require('../models/destinationModel');
const geo = require('../data/bangladesh');
const { escapeRegex } = require('./query');
const { uniqueSlug } = require('./destinations');

/**
 * Find the destination for a built-in place (the country, a division or a district), or create it.
 * An existing place with the same type and name is adopted, so admins never get duplicates.
 * Returns { node, created }.
 */
const ensurePlace = async ({ code, type, name, nameBn, lat, lng, slug, parent, status = 'published', userId }) => {
  let node = await Destination.findOne({ geoCode: code });
  if (node) return { node, created: false };
  node = await Destination.findOne({ type, name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }, geoCode: { $exists: false } });
  if (node) {
    node.geoCode = code;
    await node.save({ validateBeforeSave: false });
    return { node, created: false };
  }
  node = await Destination.create({
    name,
    nameBn,
    type,
    geoCode: code,
    slug: await uniqueSlug(slug || name),
    parent: parent ? parent._id : null,
    ancestors: parent ? [...parent.ancestors, parent._id] : [],
    location: { type: 'Point', coordinates: [lng, lat] },
    status,
    createdBy: userId,
    updatedBy: userId
  });
  return { node, created: true };
};

const ensureCountry = opts => ensurePlace({ ...geo.COUNTRY, slug: 'bangladesh', type: 'country', ...opts });

const ensureDivision = async (code, opts = {}) => {
  const division = geo.findDivision(code);
  if (!division) return null;
  const country = await ensureCountry(opts);
  const result = await ensurePlace({ ...division, type: 'region', parent: country.node, ...opts });
  return { ...result, createdNames: [country, result].filter(r => r.created).map(r => r.node.name) };
};

const ensureDistrict = async (code, opts = {}) => {
  const found = geo.findDistrict(code);
  if (!found) return null;
  const division = await ensureDivision(found.division.code, opts);
  const result = await ensurePlace({ ...found.district, type: 'city', parent: division.node, ...opts });
  return { ...result, createdNames: [...division.createdNames, ...(result.created ? [result.node.name] : [])] };
};

// The built-in list, marked with the destinations that already exist for each place
const geographyWithExisting = async () => {
  const codes = await Destination.find({ geoCode: { $exists: true } }).select('geoCode name status').lean();
  const byCode = new Map(codes.map(d => [d.geoCode, d]));
  const mark = item => {
    const d = byCode.get(item.code);
    return { ...item, existing: d ? { _id: d._id, name: d.name, status: d.status } : null };
  };
  return {
    country: mark(geo.COUNTRY),
    divisions: geo.divisions.map(div => ({ ...mark(div), districts: div.districts.map(mark) }))
  };
};

module.exports = { ensureCountry, ensureDivision, ensureDistrict, geographyWithExisting, findDivision: geo.findDivision, findDistrict: geo.findDistrict };
