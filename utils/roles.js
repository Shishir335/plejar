/**
 * One person, one account, several roles: the same login can be a traveler in the app, part of an
 * agency in the vendor panel, and Plezar staff in the admin panel.
 * `roles` holds them all; `role` is kept as the main one (the most powerful) for older code and labels.
 */

const ROLES = ['user', 'agent', 'manager', 'admin', 'dev'];
const STAFF = ['manager', 'admin', 'dev'];
// Most powerful first
const ORDER = ['dev', 'admin', 'manager', 'agent', 'user'];
const LABELS = { user: 'Traveler', agent: 'Vendor', manager: 'Manager', admin: 'Admin', dev: 'Developer' };

/** Every role an account has (accounts saved before roles existed only have `role`) */
const rolesOf = user => {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length) return [...user.roles];
  return user.role ? [user.role] : [];
};

const hasRole = (user, ...roles) => rolesOf(user).some(r => roles.includes(r));
const mainRole = roles => ORDER.find(r => roles.includes(r)) || 'user';
// A plain traveler: no vendor or staff role. Managers may only look after these accounts.
const isTravelerOnly = user => rolesOf(user).every(r => r === 'user');

/** Add or take away roles on a user document (not saved); keeps `role` as the main one */
const setRoles = (user, roles) => {
  const clean = ORDER.filter(r => roles.includes(r)).reverse();
  user.roles = clean.length ? clean : ['user'];
  user.role = mainRole(user.roles);
  return user;
};
const addRole = (user, role) => setRoles(user, [...rolesOf(user), role]);
const removeRole = (user, role) => setRoles(user, rolesOf(user).filter(r => r !== role));

/**
 * Filter for accounts that have a role, which also matches accounts saved before `roles` existed.
 * Combine with other conditions through $and.
 */
const roleFilter = role => ({ $or: [{ roles: role }, { 'roles.0': { $exists: false }, role }] });

module.exports = { ROLES, STAFF, LABELS, rolesOf, hasRole, mainRole, isTravelerOnly, setRoles, addRole, removeRole, roleFilter };
