const Agency = require('../models/agencyModel');

/**
 * One account can run a tour agency and a hotel with the same email and password.
 * `user.agency` / `agencyRole` is the main vendor link (the tour agency when there are both);
 * `user.hotelAgency` / `hotelAgencyRole` is the hotel next to it. Someone with only a hotel keeps
 * it in `agency`, as before, so nothing older needs moving.
 */

const idOf = x => (x && x._id ? x._id : x);
const same = (a, b) => Boolean(a && b) && String(idOf(a)) === String(idOf(b));

// Query filters for the people in a vendor, and for its owner
const memberOf = id => ({ $or: [{ agency: idOf(id) }, { hotelAgency: idOf(id) }] });
const ownerOf = id => ({ $or: [{ agency: idOf(id), agencyRole: 'owner' }, { hotelAgency: idOf(id), hotelAgencyRole: 'owner' }] });
const ownersOfAny = ids => ({ $or: [{ agency: { $in: ids }, agencyRole: 'owner' }, { hotelAgency: { $in: ids }, hotelAgencyRole: 'owner' }] });

const isIn = (user, id) => same(user.agency, id) || same(user.hotelAgency, id);
// This person's role in that vendor
const roleIn = (user, id) => (same(user.hotelAgency, id) ? user.hotelAgencyRole : user.agencyRole);

// Every vendor id → its owner, from a list of users found with ownersOfAny
const ownersById = owners => {
  const out = {};
  owners.forEach(u => {
    if (u.agency && u.agencyRole === 'owner') out[String(u.agency)] = u;
    if (u.hotelAgency && u.hotelAgencyRole === 'owner') out[String(u.hotelAgency)] = u;
  });
  return out;
};

// Member counts per vendor id, counting both links
const memberCountPipeline = ids => [
  { $match: { $or: [{ agency: { $in: ids } }, { hotelAgency: { $in: ids } }] } },
  { $project: { links: { $filter: { input: ['$agency', '$hotelAgency'], cond: { $in: ['$$this', ids] } } } } },
  { $unwind: '$links' },
  { $group: { _id: '$links', count: { $sum: 1 } } }
];

// Can this account take on a vendor of this kind ('agency' or 'hotel')? Returns null, or why not.
const cannotLink = async (user, kind) => {
  if (!user.agency) return null;
  if (user.hotelAgency) return 'both';
  const current = await Agency.findById(user.agency).select('kind').lean();
  if (!current) return null; // a link to a vendor that no longer exists
  return (current.kind || 'agency') === kind ? 'same' : null;
};

// Link the account to a vendor (not saved). Call cannotLink first.
const link = async (user, agency, role) => {
  const current = user.agency ? await Agency.findById(user.agency).select('kind').lean() : null;
  if (!current) {
    user.agency = agency._id;
    user.agencyRole = role;
  } else if ((agency.kind || 'agency') === 'hotel') {
    user.hotelAgency = agency._id;
    user.hotelAgencyRole = role;
  } else {
    // A hotel owner now also runs a tour agency: the tour agency becomes the main link
    user.hotelAgency = user.agency;
    user.hotelAgencyRole = user.agencyRole;
    user.agency = agency._id;
    user.agencyRole = role;
  }
};

// Take the account out of a vendor (not saved). Returns true while it is still in another one.
const unlink = (user, id) => {
  if (same(user.hotelAgency, id)) {
    user.hotelAgency = null;
    user.hotelAgencyRole = null;
  } else if (same(user.agency, id)) {
    user.agency = user.hotelAgency || null;
    user.agencyRole = user.hotelAgency ? user.hotelAgencyRole : null;
    user.hotelAgency = null;
    user.hotelAgencyRole = null;
  }
  return Boolean(user.agency);
};

module.exports = { same, memberOf, ownerOf, ownersOfAny, ownersById, memberCountPipeline, isIn, roleIn, cannotLink, link, unlink };
