/**
 * Tourist spots from .xlsx spreadsheets, and how to tell two names for the same place apart.
 * Used by scripts/import-tourist-spots.js (adds them) and scripts/keep-only-tourist-spots.js (removes the rest).
 *
 * A sheet with these columns is read; other sheets, such as a read-me, are skipped:
 *   Division | District | Place Name English | Place Name Bangla | Latitude | Longitude | Short Summary
 */
const fs = require('fs');
const path = require('path');
const geo = require('../data/bangladesh');
const { readXlsx } = require('./xlsx');

// ---- Districts: the spreadsheet's spelling to the built-in list ----
const key = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
// Older and other common spellings
const ALIASES = {
  barisal: 'barishal', chittagong: 'chattogram', comilla: 'cumilla', coxsbazaar: 'coxsbazar', jessore: 'jashore', bogra: 'bogura',
  chapainawabganj: 'chapainawabganj', nawabganj: 'chapainawabganj', jhalakathi: 'jhalokathi', jhalokati: 'jhalokathi', jhalakati: 'jhalokathi',
  khagrachari: 'khagrachhari', netrakona: 'netrokona', maulvibazar: 'moulvibazar', moulavibazar: 'moulvibazar', sirajgonj: 'sirajganj',
  kishorganj: 'kishoreganj', narshingdi: 'narsingdi', laxmipur: 'lakshmipur', lakshmipur: 'lakshmipur', brahmanbaria: 'brahmanbaria',
  panchagarh: 'panchagarh', panchagar: 'panchagarh', thakurgaon: 'thakurgaon', munshigonj: 'munshiganj', gopalgonj: 'gopalganj'
};
const DISTRICTS = new Map();
geo.divisions.forEach(division => division.districts.forEach(district => DISTRICTS.set(key(district.name), { division, district })));
const findDistrict = name => {
  const k = key(name);
  return DISTRICTS.get(ALIASES[k] || k) || null;
};

// ---- Names: "Kuakata Sea Beach" is "Kuakata", "Char Kukri-Mukri" is "Char Kukri-Mukri Wildlife Sanctuary" ----
const nameKey = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
// Words that say what kind of place it is rather than which one
const GENERIC = new Set(('the of at and sea beach beaches sea-beach falls fall waterfall waterfalls jharna national park eco ecopark forest '
  + 'reserved reserve wildlife sanctuary area spot site point view viewpoint floating market guava gardens garden').split(' '));
const core = s => {
  const words = nameKey(s).split(' ').filter(w => w && !GENERIC.has(w));
  return words.length ? words.join(' ') : nameKey(s);
};
const looksSame = (a, b) => Boolean(core(a)) && core(a) === core(b);

// Bangladesh, with a little room at the borders
const inBangladesh = (lat, lng) => lat >= 20.3 && lat <= 26.8 && lng >= 87.9 && lng <= 92.8;
const coordinate = v => {
  const n = Number(String(v || '').trim());
  return String(v || '').trim() !== '' && Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
};

const HEADERS = ['division', 'district', 'place name english', 'place name bangla', 'latitude', 'longitude', 'short summary'];

// Every spot in the files, once each
const readSpots = files => {
  const spots = new Map();
  const problems = [];
  files.forEach(file => {
    const sheets = readXlsx(fs.readFileSync(file));
    sheets.forEach(sheet => {
      const head = (sheet.rows[0] || []).map(h => String(h).toLowerCase().trim());
      const col = Object.fromEntries(HEADERS.map(h => [h, head.indexOf(h)]));
      if (col.district < 0 || col['place name english'] < 0) return; // not a sheet of spots
      sheet.rows.slice(1).forEach((row, i) => {
        const at = `${path.basename(file)} › ${sheet.name} row ${i + 2}`;
        const cell = h => (col[h] >= 0 ? String(row[col[h]] || '').trim() : '');
        const name = cell('place name english').replace(/\s+/g, ' ');
        if (!name) return;
        const found = findDistrict(cell('district'));
        if (!found) {
          problems.push(`${at}: unknown district "${cell('district')}" for ${name}`);
          return;
        }
        const lat = coordinate(cell('latitude'));
        const lng = coordinate(cell('longitude'));
        const spot = {
          name: name.slice(0, 120),
          nameBn: cell('place name bangla').slice(0, 120),
          summary: cell('short summary').slice(0, 300),
          district: found.district,
          division: found.division,
          lat: lat != null && lng != null && inBangladesh(lat, lng) ? lat : null,
          lng: lat != null && lng != null && inBangladesh(lat, lng) ? lng : null,
          from: at
        };
        if (lat != null && lng != null && spot.lat == null) problems.push(`${at}: ${name} has coordinates outside Bangladesh (${lat}, ${lng}); left empty`);
        const id = `${spot.district.code}|${nameKey(name)}`;
        const before = spots.get(id);
        // Listed twice: keep the fuller record (coordinates, Bangla name, longer summary)
        if (before) {
          spots.set(id, {
            ...before,
            nameBn: before.nameBn || spot.nameBn,
            summary: spot.summary.length > before.summary.length ? spot.summary : before.summary,
            lat: before.lat != null ? before.lat : spot.lat,
            lng: before.lng != null ? before.lng : spot.lng
          });
        } else spots.set(id, spot);
      });
    });
  });
  return { spots: [...spots.values()], problems };
};

module.exports = { findDistrict, nameKey, core, looksSame, readSpots };
