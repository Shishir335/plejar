const Destination = require('../models/destinationModel');
const DestinationCategory = require('../models/destinationCategoryModel');
const Package = require('../models/packageModel');
const Booking = require('../models/bookingModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');
const { escapeRegex, pageParams, paged, validId, toId } = require('../utils/query');
const { saveDestinationImage, removeDestinationImage, removeDestinationFolder } = require('../utils/uploads');
const {
  uniqueSlug, slugify, placeUnder, refreshDescendants, rollupStats, statsOf, trendingScore, popularityScore, pathNames, toMonths, toLocation
} = require('../utils/destinations');

const { ensureCountry, ensureDivision, ensureDistrict, geographyWithExisting, findDivision, findDistrict } = require('../utils/geography');

const MAX_PHOTOS = 20;

const findDestination = async (id, next) => {
  const dest = validId(id) ? await Destination.findById(id) : null;
  if (!dest) next(new AppError('No destination found with that ID.', 404));
  return dest;
};

const toList = (value, max, separator = /\n/) => {
  const items = Array.isArray(value) ? value : String(value || '').split(separator);
  return items.map(s => String(s).trim()).filter(Boolean).slice(0, max);
};

// A destination as the admin screens show it: with the path above it and its numbers
const listView = (d, stats, pathOf) => {
  const s = statsOf(stats, d._id);
  return {
    ...d,
    path: pathOf ? pathOf(d) : [],
    hasLocation: Boolean(d.location && d.location.coordinates && d.location.coordinates.length === 2),
    photoCount: (d.gallery || []).length,
    stats: s,
    trendingScore: trendingScore(d, s),
    popularityScore: popularityScore(d, s)
  };
};

// ---------- Overview ----------

exports.summary = catchAsync(async (req, res) => {
  const [byType, byStatus, featured, noLocation, noCover, limited, categories, vendorPending] = await Promise.all([
    Destination.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
    Destination.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Destination.countDocuments({ featured: true, status: 'published' }),
    Destination.countDocuments({ 'location.coordinates.1': { $exists: false } }),
    Destination.countDocuments({ coverImage: '' }),
    Destination.countDocuments({ 'availability.status': { $in: ['seasonal', 'restricted', 'closed'] } }),
    DestinationCategory.countDocuments(),
    Destination.countDocuments({ source: 'vendor', status: 'draft' })
  ]);
  const count = (rows, key) => (rows.find(r => r._id === key) || { count: 0 }).count;
  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        total: byType.reduce((n, r) => n + r.count, 0),
        countries: count(byType, 'country'),
        regions: count(byType, 'region'),
        cities: count(byType, 'city'),
        attractions: count(byType, 'attraction'),
        published: count(byStatus, 'published'),
        draft: count(byStatus, 'draft'),
        archived: count(byStatus, 'archived'),
        featured,
        noLocation,
        noCover,
        limited,
        categories,
        vendorPending
      }
    }
  });
});

// ---------- List ----------

// The list's filters (also used to change the status of every match at once)
const listFilter = (q = {}) => {
  const filter = {};
  if (Destination.TYPES.includes(q.type)) filter.type = q.type;
  if (['draft', 'published', 'archived'].includes(q.status)) filter.status = q.status;
  if (Destination.AVAILABILITY.includes(q.availability)) filter['availability.status'] = q.availability;
  if (q.featured === 'true') filter.featured = true;
  if (validId(q.category)) filter.categories = toId(q.category);
  if (validId(q.within)) filter.ancestors = toId(q.within);
  if (q.parent === 'none') filter.parent = null;
  else if (validId(q.parent)) filter.parent = toId(q.parent);
  if (['admin', 'vendor'].includes(q.source)) filter.source = q.source;
  if (q.missing === 'location') filter['location.coordinates.1'] = { $exists: false };
  if (q.missing === 'cover') filter.coverImage = '';
  if (q.missing === 'seo') filter.$or = [{ 'seo.title': '' }, { 'seo.description': '' }];
  if (q.missing === 'description') filter.description = '';
  if (q.search) {
    const rx = { $regex: escapeRegex(String(q.search).trim()), $options: 'i' };
    filter.$and = [{ $or: [{ name: rx }, { nameBn: rx }, { slug: rx }, { address: rx }] }];
  }
  return filter;
};

exports.listDestinations = catchAsync(async (req, res) => {
  const q = req.query;
  const filter = listFilter(q);

  const page = pageParams(q);
  const statSorts = ['popular', 'trending', 'travelers'];
  let rows;
  let total;
  let stats;
  if (statSorts.includes(q.sort)) {
    // Sorting by numbers: work them out for every match, then page
    [rows, stats] = await Promise.all([Destination.find(filter).populate('categories', 'name').populate('addedByAgency', 'name').lean(), rollupStats()]);
    total = rows.length;
    const key = { popular: x => popularityScore(x, statsOf(stats, x._id)), trending: x => trendingScore(x, statsOf(stats, x._id)), travelers: x => statsOf(stats, x._id).travelers }[q.sort];
    rows = rows.sort((a, b) => key(b) - key(a)).slice(page.skip, page.skip + page.limit);
  } else {
    const sort = { name: { name: 1 }, updated: { updatedAt: -1 }, views: { views: -1 }, created: { createdAt: -1 } }[q.sort] || { level: 1, name: 1 };
    [rows, total, stats] = await Promise.all([
      Destination.find(filter).sort(sort).skip(page.skip).limit(page.limit).populate('categories', 'name').populate('addedByAgency', 'name').lean(),
      Destination.countDocuments(filter),
      rollupStats()
    ]);
  }
  const pathOf = await pathNames(rows);
  const childCounts = await Destination.aggregate([{ $match: { parent: { $in: rows.map(r => r._id) } } }, { $group: { _id: '$parent', count: { $sum: 1 } } }]);
  const children = new Map(childCounts.map(c => [String(c._id), c.count]));

  res.status(200).json({
    status: 'success',
    data: {
      destinations: rows.map(r => ({ ...listView(r, stats, pathOf), childCount: children.get(String(r._id)) || 0, description: undefined, howToGetThere: undefined, travelTips: undefined })),
      ...paged(total, page)
    }
  });
});

// Every destination in a few fields, for pickers ("put this under...", vendor event links)
exports.options = catchAsync(async (req, res) => {
  const rows = await Destination.find().sort({ name: 1 }).select('name type parent ancestors status location').lean();
  const names = new Map(rows.map(r => [String(r._id), r.name]));
  res.status(200).json({
    status: 'success',
    data: { destinations: rows.map(r => ({ _id: r._id, name: r.name, type: r.type, parent: r.parent, ancestors: r.ancestors, status: r.status, location: r.location && r.location.coordinates && r.location.coordinates.length === 2 ? r.location : null, path: (r.ancestors || []).map(a => names.get(String(a))).filter(Boolean) })) }
  });
});

// ---------- One destination ----------

const monthlySeries = async ids => {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 11, 1);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await Booking.aggregate([
    { $match: { destinationRef: { $in: ids }, status: { $ne: 'cancelled' }, createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Dhaka' } }, bookings: { $sum: 1 }, travelers: { $sum: '$travelers' } } }
  ]);
  const map = new Map(rows.map(r => [r._id, r]));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(since);
    d.setUTCMonth(since.getUTCMonth() + i);
    const key = d.toISOString().slice(0, 7);
    const row = map.get(key) || {};
    return { month: key, bookings: row.bookings || 0, travelers: row.travelers || 0 };
  });
};

const detailPayload = async dest => {
  await dest.populate([{ path: 'categories', select: 'name active' }, { path: 'addedByAgency', select: 'name' }]);
  const subtree = [dest._id, ...(await Destination.find({ ancestors: dest._id }).select('_id').lean()).map(d => d._id)];
  const [stats, pathOf, children, events, series] = await Promise.all([
    rollupStats(),
    pathNames([dest]),
    Destination.find({ parent: dest._id }).sort({ type: 1, name: 1 }).select('name type status coverImage featured availability').lean(),
    Package.find({ destinationRef: { $in: subtree } }).sort({ startDate: -1 }).limit(20).populate('agency', 'name').select('title startDate endDate status seats agency destinationRef').lean(),
    monthlySeries(subtree)
  ]);
  const plain = dest.toObject();
  return {
    destination: listView(plain, stats, pathOf),
    parentPath: pathOf(plain),
    children,
    events,
    series,
    descendantCount: subtree.length - 1
  };
};

exports.getDestination = catchAsync(async (req, res, next) => {
  const dest = await findDestination(req.params.id, next);
  if (!dest) return;
  res.status(200).json({ status: 'success', data: await detailPayload(dest) });
});

// Fields an admin can edit, applied to a destination (new or existing)
const applyFields = async (dest, body, isNew) => {
  ['name', 'nameBn', 'summary', 'description', 'howToGetThere', 'travelTips', 'address', 'videoUrl'].forEach(f => {
    if (body[f] !== undefined) dest[f] = String(body[f]);
  });
  if (body.highlights !== undefined) dest.highlights = toList(body.highlights, 20);
  if (body.bestMonths !== undefined) dest.bestMonths = toMonths(body.bestMonths);
  if (body.lat !== undefined || body.lng !== undefined) {
    const loc = toLocation(body.lat, body.lng);
    dest.location = loc || undefined;
  }
  if (body.categories !== undefined) {
    const ids = [].concat(body.categories).filter(validId);
    dest.categories = (await DestinationCategory.find({ _id: { $in: ids } }).select('_id')).map(c => c._id);
  }
  if (body.availability !== undefined) {
    const a = body.availability || {};
    if (a.status !== undefined) {
      if (!Destination.AVAILABILITY.includes(a.status)) throw new AppError('Choose open, seasonal, restricted or closed.', 400);
      dest.availability.status = a.status;
    }
    if (a.openMonths !== undefined) dest.availability.openMonths = toMonths(a.openMonths);
    if (a.note !== undefined) dest.availability.note = String(a.note);
    if (dest.availability.status === 'seasonal' && !dest.availability.openMonths.length) {
      throw new AppError('Choose the months a seasonal place is open.', 400);
    }
  }
  if (body.seo !== undefined) {
    const seo = body.seo || {};
    if (seo.title !== undefined) dest.seo.title = String(seo.title);
    if (seo.description !== undefined) dest.seo.description = String(seo.description);
    if (seo.keywords !== undefined) dest.seo.keywords = toList(seo.keywords, 15, /[,\n]/);
  }
  if (body.featured !== undefined) dest.featured = body.featured === true || body.featured === 'true';
  if (body.trendingPinned !== undefined) dest.trendingPinned = body.trendingPinned === true || body.trendingPinned === 'true';
  if (body.status !== undefined) {
    if (!['draft', 'published', 'archived'].includes(body.status)) throw new AppError('Status must be draft, published or archived.', 400);
    dest.status = body.status;
  }

  // Type and place in the tree
  if (isNew || body.type !== undefined || body.parent !== undefined) {
    const type = body.type !== undefined ? body.type : dest.type;
    if (!Destination.TYPES.includes(type)) throw new AppError('Choose a type: country, region, city or attraction.', 400);
    if (!isNew && type !== dest.type && (await Destination.exists({ parent: dest._id }))) {
      const kids = await Destination.find({ parent: dest._id }).select('type').lean();
      const bad = kids.find(k => !Destination.PARENT_TYPES[k.type].includes(type));
      if (bad) throw new AppError(`Places inside this one can't sit under a ${type}. Move them first.`, 400);
    }
    const parentId = body.parent !== undefined ? (body.parent || null) : dest.parent;
    const placed = await placeUnder(type, parentId, isNew ? null : dest._id);
    dest.type = type;
    dest.parent = placed.parent;
    dest.ancestors = placed.ancestors;
  }

  if (body.slug !== undefined && String(body.slug).trim()) {
    const wanted = slugify(body.slug);
    if (!wanted) throw new AppError('The web address needs at least one letter or number.', 400);
    if (await Destination.exists({ slug: wanted, _id: { $ne: dest._id } })) throw new AppError(`Another place already uses /${wanted}. Choose a different web address.`, 400);
    dest.slug = wanted;
  } else if (isNew) {
    dest.slug = await uniqueSlug(dest.name);
  }

  if (dest.status === 'published' && !dest.name) throw new AppError('Enter the name.', 400);
};

// The built-in divisions and districts, for the "where is it?" pickers
exports.geography = catchAsync(async (req, res) => {
  res.status(200).json({ status: 'success', data: await geographyWithExisting() });
});

/**
 * Work out where a new place goes from the division and district the admin picked
 * (creating the country, division or district on the way if they don't exist yet).
 * Returns { parent, geoCode, defaults, createdNames } or { duplicate } when the place already exists.
 */
const placeFromGeography = async (type, picked, userId) => {
  const opts = { userId };
  if (type === 'country') return {};
  if (type === 'region') {
    const division = findDivision(picked.division);
    if (!division) throw new AppError('Choose the division.', 400);
    const existing = await Destination.findOne({ geoCode: division.code }).select('name');
    if (existing) return { duplicate: existing };
    const country = await ensureCountry(opts);
    return { parent: country.node._id, geoCode: division.code, defaults: division, createdNames: country.created ? [country.node.name] : [] };
  }
  if (type === 'city') {
    if (!findDivision(picked.division)) throw new AppError('Choose the division.', 400);
    if (picked.district) {
      const found = findDistrict(picked.district);
      if (!found || found.division.code !== picked.division) throw new AppError('Choose a district in that division.', 400);
      const existing = await Destination.findOne({ geoCode: found.district.code }).select('name');
      if (existing) return { duplicate: existing };
      const division = await ensureDivision(found.division.code, opts);
      return { parent: division.node._id, geoCode: found.district.code, defaults: found.district, createdNames: division.createdNames };
    }
    const division = await ensureDivision(picked.division, opts);
    return { parent: division.node._id, createdNames: division.createdNames };
  }
  // An attraction sits inside a district
  const found = picked.district && findDistrict(picked.district);
  if (!found || found.division.code !== picked.division) throw new AppError('Choose the division and then the district this place is in.', 400);
  const district = await ensureDistrict(found.district.code, opts);
  return { parent: district.node._id, createdNames: district.createdNames };
};

exports.createDestination = catchAsync(async (req, res) => {
  const body = { ...req.body };
  let placed = {};
  // Bangladesh places come with a division and district; other countries pick a parent directly
  if (body.geo && (body.geo.division || body.geo.district)) {
    placed = await placeFromGeography(body.type, body.geo, req.user._id);
    if (placed.duplicate) {
      return res.status(409).json({
        status: 'fail',
        message: `${placed.duplicate.name} already exists. Open it instead of adding it again.`,
        data: { existing: { _id: placed.duplicate._id, name: placed.duplicate.name } }
      });
    }
    if (placed.parent) body.parent = placed.parent;
    const d = placed.defaults;
    if (d) {
      if (!String(body.name || '').trim()) body.name = d.name;
      if (!String(body.nameBn || '').trim()) body.nameBn = d.nameBn;
      if ((body.lat === undefined || body.lat === '') && (body.lng === undefined || body.lng === '')) {
        body.lat = d.lat;
        body.lng = d.lng;
      }
    }
  }

  const dest = new Destination({ createdBy: req.user._id, updatedBy: req.user._id });
  await applyFields(dest, body, true);
  if (placed.geoCode) dest.geoCode = placed.geoCode;
  await dest.save();
  await logActivity(req, { action: 'destination.created', summary: `Added ${dest.type} "${dest.name}" (${dest.status})${placed.createdNames && placed.createdNames.length ? `; also added ${placed.createdNames.join(', ')}` : ''}` });
  res.status(201).json({ status: 'success', data: { ...(await detailPayload(dest)), alsoCreated: placed.createdNames || [] } });
});

exports.updateDestination = catchAsync(async (req, res, next) => {
  const dest = await findDestination(req.params.id, next);
  if (!dest) return;
  const oldPath = dest.ancestors.map(String).join('/');
  await applyFields(dest, req.body, false);
  dest.updatedBy = req.user._id;
  await dest.save();
  if (dest.ancestors.map(String).join('/') !== oldPath) await refreshDescendants(dest);
  await logActivity(req, { action: 'destination.updated', summary: `Edited ${dest.type} "${dest.name}" (${dest.status})` });
  res.status(200).json({ status: 'success', data: await detailPayload(dest) });
});

// Publish, unpublish or archive many places at once:
//   { status, ids: [...] }                    the ticked rows
//   { status, all: true, filter: {...} }      every place matching the list's filters (same names as the list's query)
exports.setStatuses = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  if (!['draft', 'published', 'archived'].includes(status)) return next(new AppError('Status must be draft, published or archived.', 400));
  let filter;
  if (req.body.all === true) {
    filter = listFilter(req.body.filter && typeof req.body.filter === 'object' ? req.body.filter : {});
  } else {
    const ids = [].concat(req.body.ids || []).filter(validId);
    if (!ids.length) return next(new AppError('Choose at least one place.', 400));
    if (ids.length > 1000) return next(new AppError('Choose at most 1000 places at a time.', 400));
    filter = { _id: { $in: ids.map(toId) } };
  }
  const matched = await Destination.countDocuments(filter);
  // Only published places can be featured or pinned as trending
  const set = { status, updatedBy: req.user._id, ...(status === 'published' ? {} : { featured: false, featuredOrder: 0, trendingPinned: false }) };
  const result = await Destination.updateMany({ $and: [filter, { status: { $ne: status } }] }, { $set: set });
  const changed = result.modifiedCount || 0;
  if (changed) {
    await logActivity(req, { action: 'destination.status_bulk', summary: `${{ published: 'Published', draft: 'Moved to draft', archived: 'Archived' }[status]} ${changed} destination${changed === 1 ? '' : 's'}` });
  }
  res.status(200).json({ status: 'success', data: { matched, changed, status } });
});

exports.deleteDestination = catchAsync(async (req, res, next) => {
  const dest = await findDestination(req.params.id, next);
  if (!dest) return;
  const kids = await Destination.countDocuments({ parent: dest._id });
  if (kids) return next(new AppError(`${kids} place${kids === 1 ? ' sits' : 's sit'} inside "${dest.name}". Move or delete ${kids === 1 ? 'it' : 'them'} first.`, 400));
  const [events, bookings] = await Promise.all([Package.countDocuments({ destinationRef: dest._id }), Booking.countDocuments({ destinationRef: dest._id })]);
  if (events || bookings) {
    return next(new AppError(`Tour events or bookings are linked to "${dest.name}", so it can't be deleted. Archive it instead to hide it.`, 400));
  }
  await dest.deleteOne();
  await removeDestinationFolder(dest._id);
  await logActivity(req, { action: 'destination.deleted', summary: `Deleted ${dest.type} "${dest.name}"` });
  res.status(204).json({ status: 'success', data: null });
});

// ---------- Photos ----------

exports.addPhotos = catchAsync(async (req, res, next) => {
  const dest = await findDestination(req.params.id, next);
  if (!dest) return;
  const files = req.files || [];
  if (!files.length) return next(new AppError('Choose at least one photo.', 400));
  if (dest.gallery.length + files.length > MAX_PHOTOS) {
    return next(new AppError(`A destination can have ${MAX_PHOTOS} photos. Remove ${dest.gallery.length + files.length - MAX_PHOTOS} first.`, 400));
  }
  const urls = await Promise.all(files.map(f => saveDestinationImage(f, dest._id)));
  urls.forEach(url => dest.gallery.push({ url }));
  if (!dest.coverImage) dest.coverImage = urls[0];
  dest.updatedBy = req.user._id;
  await dest.save();
  await logActivity(req, { action: 'destination.photos_added', summary: `Added ${urls.length} photo${urls.length === 1 ? '' : 's'} to "${dest.name}"` });
  res.status(201).json({ status: 'success', data: await detailPayload(dest) });
});

// Reorder photos, edit captions and credits, choose the cover
exports.updatePhotos = catchAsync(async (req, res, next) => {
  const dest = await findDestination(req.params.id, next);
  if (!dest) return;
  if (Array.isArray(req.body.gallery)) {
    const byId = new Map(dest.gallery.map(p => [String(p._id), p]));
    const ordered = req.body.gallery.map(item => {
      const photo = byId.get(String(item._id));
      if (!photo) return null;
      if (item.caption !== undefined) photo.caption = String(item.caption).slice(0, 200);
      if (item.credit !== undefined) photo.credit = String(item.credit).slice(0, 200);
      byId.delete(String(item._id));
      return photo;
    }).filter(Boolean);
    dest.gallery = [...ordered, ...byId.values()];
  }
  if (req.body.coverImage !== undefined) {
    if (req.body.coverImage && !dest.gallery.some(p => p.url === req.body.coverImage)) return next(new AppError('Choose a cover from this place\'s photos.', 400));
    dest.coverImage = req.body.coverImage || '';
  }
  dest.updatedBy = req.user._id;
  await dest.save();
  res.status(200).json({ status: 'success', data: await detailPayload(dest) });
});

exports.deletePhoto = catchAsync(async (req, res, next) => {
  const dest = await findDestination(req.params.id, next);
  if (!dest) return;
  const photo = dest.gallery.id(req.params.photoId);
  if (!photo) return next(new AppError('No photo found with that ID.', 404));
  const { url } = photo;
  photo.deleteOne();
  if (dest.coverImage === url) dest.coverImage = dest.gallery.length ? dest.gallery[0].url : '';
  dest.updatedBy = req.user._id;
  await dest.save();
  await removeDestinationImage(url);
  res.status(200).json({ status: 'success', data: await detailPayload(dest) });
});

// ---------- Featured and trending ----------

exports.listFeatured = catchAsync(async (req, res) => {
  const [rows, stats] = await Promise.all([
    Destination.find({ featured: true }).sort({ featuredOrder: 1, name: 1 }).lean(),
    rollupStats()
  ]);
  const pathOf = await pathNames(rows);
  res.status(200).json({ status: 'success', data: { destinations: rows.map(r => listView(r, stats, pathOf)) } });
});

// Set the featured list and its order in one go: { ids: [...] }
exports.setFeatured = catchAsync(async (req, res, next) => {
  const ids = [].concat(req.body.ids || []).filter(validId);
  if (ids.length > 30) return next(new AppError('Feature at most 30 places.', 400));
  const found = await Destination.find({ _id: { $in: ids } }).select('_id status name');
  const notPublished = found.filter(d => d.status !== 'published');
  if (notPublished.length) return next(new AppError(`Publish ${notPublished.map(d => `"${d.name}"`).join(', ')} before featuring ${notPublished.length === 1 ? 'it' : 'them'}.`, 400));
  await Destination.updateMany({ featured: true, _id: { $nin: ids } }, { featured: false, featuredOrder: 0 });
  await Promise.all(ids.map((id, i) => Destination.updateOne({ _id: id }, { featured: true, featuredOrder: i + 1 })));
  await logActivity(req, { action: 'destination.featured', summary: `Updated the featured destinations (${ids.length})` });
  return exports.listFeatured(req, res, next);
});

// Places travelers are booking most lately (pinned ones first)
exports.listTrending = catchAsync(async (req, res) => {
  const [rows, stats] = await Promise.all([Destination.find({ status: 'published' }).lean(), rollupStats()]);
  const scored = rows
    .map(r => ({ r, score: trendingScore(r, statsOf(stats, r._id)) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(x => x.r);
  const pathOf = await pathNames(scored);
  res.status(200).json({ status: 'success', data: { destinations: scored.map(r => listView(r, stats, pathOf)) } });
});

// ---------- Statistics ----------

exports.statistics = catchAsync(async (req, res) => {
  const [rows, stats] = await Promise.all([Destination.find().select('name type status views ancestors parent featured trendingPinned').lean(), rollupStats()]);
  const pathOf = await pathNames(rows);
  const view = r => ({ _id: r._id, name: r.name, type: r.type, status: r.status, views: r.views, path: pathOf(r), stats: statsOf(stats, r._id) });
  const top = (key, list = rows) => list
    .map(view)
    .filter(r => key(r) > 0)
    .sort((a, b) => key(b) - key(a))
    .slice(0, 10);
  // Rank actual places (nothing inside them), so a city doesn't repeat its attractions' numbers
  const hasChildren = new Set(rows.filter(r => r.parent).map(r => String(r.parent)));
  const leaves = rows.filter(r => (r.type === 'attraction' || r.type === 'city') && !hasChildren.has(String(r._id)));

  res.status(200).json({
    status: 'success',
    data: {
      topByTravelers: top(r => r.stats.travelers, leaves),
      topByRevenue: top(r => r.stats.revenue, leaves),
      topByViews: top(r => r.views, leaves),
      topByEvents: top(r => r.stats.upcomingEvents, leaves),
      regions: rows.filter(r => r.type === 'region').map(view).sort((a, b) => b.stats.travelers - a.stats.travelers),
      totals: {
        views: rows.reduce((n, r) => n + (r.views || 0), 0),
        linkedEvents: await Package.countDocuments({ destinationRef: { $ne: null } }),
        unlinkedEvents: await Package.countDocuments({ destinationRef: null, startDate: { $exists: true } })
      }
    }
  });
});

// ---------- Categories ----------

exports.listCategories = catchAsync(async (req, res) => {
  const [categories, usage] = await Promise.all([
    DestinationCategory.find().sort({ name: 1 }).lean(),
    Destination.aggregate([{ $unwind: '$categories' }, { $group: { _id: '$categories', count: { $sum: 1 } } }])
  ]);
  const used = new Map(usage.map(u => [String(u._id), u.count]));
  res.status(200).json({ status: 'success', data: { categories: categories.map(c => ({ ...c, destinations: used.get(String(c._id)) || 0 })) } });
});

exports.createCategory = catchAsync(async (req, res) => {
  const category = await DestinationCategory.create({ name: req.body.name, nameBn: req.body.nameBn, description: req.body.description });
  await logActivity(req, { action: 'destination_category.created', summary: `Created destination category "${category.name}"` });
  res.status(201).json({ status: 'success', data: { category } });
});

exports.updateCategory = catchAsync(async (req, res, next) => {
  const category = validId(req.params.id) ? await DestinationCategory.findById(req.params.id) : null;
  if (!category) return next(new AppError('No category found with that ID.', 404));
  ['name', 'nameBn', 'description'].forEach(f => { if (req.body[f] !== undefined) category[f] = req.body[f]; });
  if (req.body.active !== undefined) category.active = req.body.active === true || req.body.active === 'true';
  await category.save();
  res.status(200).json({ status: 'success', data: { category } });
});

exports.deleteCategory = catchAsync(async (req, res, next) => {
  const category = validId(req.params.id) ? await DestinationCategory.findById(req.params.id) : null;
  if (!category) return next(new AppError('No category found with that ID.', 404));
  const used = await Destination.countDocuments({ categories: category._id });
  if (used) return next(new AppError(`${used} destination${used === 1 ? ' uses' : 's use'} "${category.name}". Switch it off instead, or remove it from ${used === 1 ? 'that place' : 'those places'} first.`, 400));
  await category.deleteOne();
  res.status(204).json({ status: 'success', data: null });
});
