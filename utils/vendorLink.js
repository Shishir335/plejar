const mongoose = require('mongoose');
const Agency = require('../models/agencyModel');
const User = require('../models/userModel');
const { ownerOf } = require('./vendorMembership');

/**
 * The Vendor role only means something together with an agency: the vendor panel opens that
 * agency's data. Call this whenever an admin gives someone the Vendor role, with
 * { agency, agencyRole } from the request. Links the user (not saved), or returns why it can't.
 * Without an agency in the request, someone already linked simply stays where they are.
 */
const linkVendorAgency = async (user, { agency, agencyRole } = {}) => {
  if (!agency) {
    if (user.agency && await Agency.exists({ _id: user.agency })) return null;
    return 'Choose which agency this person belongs to. The Vendor role needs an agency.';
  }
  const target = mongoose.isValidObjectId(agency) ? await Agency.findById(agency).select('name') : null;
  if (!target) return 'Choose an agency from the list.';
  if (agencyRole !== undefined && agencyRole !== '' && !['owner', 'staff'].includes(agencyRole)) return 'Choose owner or staff for the agency role.';

  const moving = user.agency && String(user.agency) !== String(target._id);
  if (moving && user.agencyRole === 'owner') return "This person owns their current agency, so they can't move to another one.";

  const otherOwner = await User.findOne({ ...ownerOf(target._id), _id: { $ne: user._id } }).select('name').lean();
  // Not chosen: the owner if the agency has none, staff otherwise; someone already there keeps their role
  const firstRole = otherOwner ? 'staff' : 'owner';
  const role = agencyRole || (moving || !user.agencyRole ? firstRole : user.agencyRole);
  if (role === 'owner' && otherOwner) return `${target.name} already has an owner (${otherOwner.name}). Add this person as staff.`;

  user.agency = target._id;
  user.agencyRole = role;
  return null;
};

module.exports = { linkVendorAgency };
