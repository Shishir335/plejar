const mongoose = require('mongoose');
const Agency = require('../models/agencyModel');
const User = require('../models/userModel');
const { ownerOf, same } = require('./vendorMembership');

/**
 * The Vendor role only means something together with a business: the panel opens its data.
 * One account can be in one tour agency (/agent) and one hotel (/hotel); see utils/vendorMembership.js.
 *
 * Call this whenever an admin gives someone the Vendor role, with the request body:
 *   { agency, agencyRole, hotel, hotelRole }  the tour agency and the hotel ('' for none)
 *   { agency, agencyRole }                    older form: one business of either kind; the other stays
 * Links the user (not saved), or returns why it can't. Without any business in the request,
 * someone already linked simply stays where they are.
 */

const VENDOR_ROLES = ['owner', 'staff'];

// Where this person is now: { tour: {id, role}, hotel: {id, role} }
const currentLinks = async user => {
  const out = { tour: null, hotel: null };
  if (user.agency) {
    const main = await Agency.findById(user.agency).select('kind').lean();
    if (main) out[main.kind === 'hotel' ? 'hotel' : 'tour'] = { id: user.agency, role: user.agencyRole };
  }
  if (user.hotelAgency) out.hotel = { id: user.hotelAgency, role: user.hotelAgencyRole };
  return out;
};

// Check one choice; returns { link } or { error }
const choose = async (user, slot, id, role, current) => {
  const label = slot === 'hotel' ? 'hotel' : 'tour agency';
  if (!id) {
    if (current && current.role === 'owner') {
      const was = await Agency.findById(current.id).select('name').lean();
      return { error: `This person owns ${was ? was.name : `their ${label}`}, so they can't leave it.` };
    }
    return { link: null };
  }
  const target = mongoose.isValidObjectId(id) ? await Agency.findById(id).select('name kind') : null;
  if (!target || (target.kind === 'hotel') !== (slot === 'hotel')) return { error: `Choose a ${label} from the list.` };
  if (role !== undefined && role !== null && role !== '' && !VENDOR_ROLES.includes(role)) return { error: `Choose owner or staff for the role in the ${label}.` };

  const moving = current && !same(current.id, target._id);
  if (moving && current.role === 'owner') return { error: `This person owns their current ${label}, so they can't move to another one.` };

  const otherOwner = await User.findOne({ ...ownerOf(target._id), _id: { $ne: user._id } }).select('name').lean();
  // Not chosen: the owner if it has none, staff otherwise; someone already there keeps their role
  const firstRole = otherOwner ? 'staff' : 'owner';
  const finalRole = role || (!current || moving || !current.role ? firstRole : current.role);
  if (finalRole === 'owner' && otherOwner) return { error: `${target.name} already has an owner (${otherOwner.name}). Add this person as staff.` };
  return { link: { id: target._id, role: finalRole } };
};

const linkVendorAgency = async (user, body = {}) => {
  const current = await currentLinks(user);
  let wantTour; let wantHotel; let tourRole; let hotelRole;

  if (body.hotel === undefined) {
    // Older form: one business, of either kind
    const { agency, agencyRole } = body;
    if (!agency) {
      if (current.tour || current.hotel) return null;
      return 'Choose which agency or hotel this person belongs to. The Vendor role needs one.';
    }
    const target = mongoose.isValidObjectId(agency) ? await Agency.findById(agency).select('kind').lean() : null;
    if (!target) return 'Choose an agency from the list.';
    const isHotel = target.kind === 'hotel';
    wantTour = isHotel ? (current.tour && current.tour.id) : agency;
    wantHotel = isHotel ? agency : (current.hotel && current.hotel.id);
    tourRole = isHotel ? (current.tour && current.tour.role) : agencyRole;
    hotelRole = isHotel ? agencyRole : (current.hotel && current.hotel.role);
  } else {
    wantTour = body.agency || null;
    wantHotel = body.hotel || null;
    tourRole = body.agencyRole;
    hotelRole = body.hotelRole;
    if (!wantTour && !wantHotel) return 'Choose a tour agency, a hotel or both. The Vendor role needs one.';
  }

  const tour = await choose(user, 'tour', wantTour, tourRole, current.tour);
  if (tour.error) return tour.error;
  const hotel = await choose(user, 'hotel', wantHotel, hotelRole, current.hotel);
  if (hotel.error) return hotel.error;

  // The tour agency is the main link when there are both
  const main = tour.link || hotel.link;
  const second = tour.link ? hotel.link : null;
  user.agency = main.id;
  user.agencyRole = main.role;
  user.hotelAgency = second ? second.id : null;
  user.hotelAgencyRole = second ? second.role : null;
  return null;
};

module.exports = { linkVendorAgency };
