// Where a traveler is and where a tour starts, as one of Bangladesh's 64 districts (data/bangladesh.js)
const geo = require('../data/bangladesh');

const DISTRICTS = geo.divisions.flatMap(division => division.districts.map(district => ({ ...district, division })));
const BY_CODE = new Map(DISTRICTS.map(d => [d.code, d]));

// Other spellings people write in a meeting point
const ALIASES = { chittagong: 'Chattogram', ctg: 'Chattogram', barisal: 'Barishal', comilla: 'Cumilla', jessore: 'Jashore', bogra: 'Bogura', "cox's bazar": 'Cox’s Bazar', 'coxs bazar': 'Cox’s Bazar', 'cox bazar': 'Cox’s Bazar', coxsbazar: 'Cox’s Bazar' };

/** The district for a code, as { code, name, nameBn, division: { code, name } }, or null */
const district = code => {
  const d = BY_CODE.get(String(code || ''));
  return d ? { code: d.code, name: d.name, nameBn: d.nameBn, division: { code: d.division.code, name: d.division.name } } : null;
};

const toRad = n => (n * Math.PI) / 180;
const km = (lat1, lng1, lat2, lng2) => {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};

/** The district whose headquarters is nearest to a point in or near Bangladesh, or null */
const nearestDistrict = (lat, lng) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const best = DISTRICTS.reduce((acc, d) => {
    const dist = km(lat, lng, d.lat, d.lng);
    return !acc || dist < acc.dist ? { d, dist } : acc;
  }, null);
  // Abroad: no district
  return best && best.dist <= 120 ? district(best.d.code) : null;
};

const words = s => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}’']+/gu, ' ')} `;

/** A district named in free text, such as "Fakirapul bus counter, Dhaka", or null. The first one named wins ("Dhaka to Sylhet"). */
const districtFromText = text => {
  const hay = words(text);
  if (!hay.trim()) return null;
  let found = null;
  let at = Infinity;
  const check = (needle, d) => {
    const i = hay.indexOf(words(needle));
    if (i !== -1 && i < at) { at = i; found = d; }
  };
  DISTRICTS.forEach(d => {
    check(d.name, d);
    if (d.nameBn) check(d.nameBn, d);
  });
  Object.entries(ALIASES).forEach(([alias, name]) => {
    const d = DISTRICTS.find(x => x.name === name);
    if (d) check(alias, d);
  });
  return found ? district(found.code) : null;
};

/**
 * Where a tour starts: the district the agent chose, or failing that a district named in its
 * meeting point or its first stop. Null when nothing says.
 */
const tourStartDistrict = tour => {
  if (!tour) return null;
  const chosen = district(tour.startDistrict);
  if (chosen) return chosen;
  const firstStop = (((tour.itinerary || [])[0] || {}).stops || [])[0];
  return districtFromText(tour.meetingPoint) || districtFromText(firstStop && firstStop.place);
};

module.exports = { district, nearestDistrict, districtFromText, tourStartDistrict };
