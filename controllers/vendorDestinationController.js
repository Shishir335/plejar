const mongoose = require('mongoose');
const Destination = require('../models/destinationModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { escapeRegex } = require('../utils/query');
const { saveDestinationImage } = require('../utils/uploads');
const { uniqueSlug, toLocation } = require('../utils/destinations');
const { ensureDivision, ensureDistrict, geographyWithExisting, findDivision, findDistrict } = require('../utils/geography');

// Vendors share Plejar's destination list: they link tour events to it, and add places that are missing.
// Places a vendor adds start as drafts; Plejar's team reviews and publishes them.

const MAX_PENDING = 50;

// Destinations a vendor can use: everything published, plus places vendors added that are waiting for review
const usableFilter = () => ({ $or: [{ status: 'published' }, { source: 'vendor', status: 'draft' }] });

const optionView = (d, names, agencyId) => ({
  _id: d._id,
  name: d.name,
  nameBn: d.nameBn,
  type: d.type,
  status: d.status,
  mine: Boolean(d.addedByAgency && String(d.addedByAgency) === String(agencyId)),
  path: (d.ancestors || []).map(a => names.get(String(a))).filter(Boolean)
});

exports.listOptions = catchAsync(async (req, res) => {
  const rows = await Destination.find(usableFilter()).sort({ name: 1 }).select('name nameBn type ancestors status addedByAgency').lean();
  const parents = await Destination.find({ _id: { $in: [...new Set(rows.flatMap(r => (r.ancestors || []).map(String)))] } }).select('name').lean();
  const names = new Map([...rows, ...parents].map(r => [String(r._id), r.name]));
  res.status(200).json({ status: 'success', data: { destinations: rows.map(r => optionView(r, names, req.agency._id)) } });
});

exports.geography = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: await geographyWithExisting() });
});

// Can this vendor link an event or a stop to this destination?
exports.usableDestination = async id => {
  if (!mongoose.isValidObjectId(id)) return null;
  return Destination.findOne({ _id: id, ...usableFilter() }).select('_id name parent status');
};

exports.addDestination = catchAsync(async (req, res, next) => {
  const b = req.body;
  const type = b.type === 'city' ? 'city' : 'attraction';
  const name = String(b.name || '').trim();
  const geo = { division: String(b.division || ''), district: String(b.district || '') };
  const opts = { userId: req.user._id };

  if (!findDivision(geo.division)) return next(new AppError('Choose the division.', 400));
  const found = geo.district ? findDistrict(geo.district) : null;
  if (geo.district && (!found || found.division.code !== geo.division)) return next(new AppError('Choose a district in that division.', 400));
  if (type === 'attraction' && !found) return next(new AppError('Choose the district the place is in.', 400));

  // A district from the list is official geography: use it (adding it if Plejar doesn't have it yet)
  if (type === 'city' && found) {
    const district = await ensureDistrict(found.district.code, opts);
    return res.status(district.created ? 201 : 200).json({
      status: 'success',
      message: district.created ? `${district.node.name} added.` : `${district.node.name} is already on Plejar, so we linked it.`,
      data: { destination: { _id: district.node._id, name: district.node.name, type: 'city', status: district.node.status }, existing: !district.created }
    });
  }

  if (!name) return next(new AppError('Enter the name of the place.', 400));
  if (name.length > 120) return next(new AppError('Keep the name under 120 characters.', 400));
  const parent = type === 'attraction' ? (await ensureDistrict(found.district.code, opts)).node : (await ensureDivision(geo.division, opts)).node;

  // Already there (any spelling case)? Link the existing place instead of adding a duplicate
  const same = await Destination.findOne({ parent: parent._id, name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }, status: { $ne: 'archived' } }).select('name type status');
  if (same) {
    return res.status(200).json({
      status: 'success',
      message: `${same.name} is already on Plejar, so we linked it.`,
      data: { destination: { _id: same._id, name: same.name, type: same.type, status: same.status }, existing: true }
    });
  }

  const pending = await Destination.countDocuments({ addedByAgency: req.agency._id, source: 'vendor', status: 'draft' });
  if (pending >= MAX_PENDING) {
    return next(new AppError(`You have ${MAX_PENDING} places waiting for Plejar's review. Please wait for some to be reviewed before adding more.`, 429));
  }

  const location = toLocation(b.lat, b.lng);
  const dest = new Destination({
    name,
    nameBn: String(b.nameBn || '').trim().slice(0, 120),
    type,
    slug: await uniqueSlug(name),
    parent: parent._id,
    ancestors: [...parent.ancestors, parent._id],
    summary: String(b.summary || '').trim().slice(0, 300),
    location: location || undefined,
    status: 'draft',
    source: 'vendor',
    addedByAgency: req.agency._id,
    createdBy: req.user._id,
    updatedBy: req.user._id
  });
  await dest.validate();
  if (req.file) {
    const url = await saveDestinationImage(req.file, dest._id);
    dest.gallery.push({ url, credit: `Photo from ${req.agency.name}` });
    dest.coverImage = url;
  }
  await dest.save();
  await logActivity(req, { action: 'destination.suggested', summary: `Added the destination "${dest.name}" for Plejar's review`, agency: req.agency._id });

  res.status(201).json({
    status: 'success',
    message: `${dest.name} added. You can use it right away; travelers see it once Plejar reviews it.`,
    data: { destination: { _id: dest._id, name: dest.name, type: dest.type, status: dest.status }, existing: false }
  });
});
