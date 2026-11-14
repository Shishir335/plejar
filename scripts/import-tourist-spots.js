/**
 * Add tourist spots from .xlsx spreadsheets to Destinations, as attractions under their district.
 *
 * Each sheet with these columns is read (other sheets, such as a read-me, are skipped):
 *   Division | District | Place Name English | Place Name Bangla | Latitude | Longitude | Short Summary
 * A spot listed twice (on an "all spots" sheet and a division's sheet, or in two files) is added once.
 *
 *   npm run import-spots -- file.xlsx [more.xlsx]                 # dry run on the production database: shows what it would do
 *   npm run import-spots -- file.xlsx --dev                       # dry run on the development database
 *   npm run import-spots -- file.xlsx --dev --apply               # add them, as drafts
 *   npm run import-spots -- file.xlsx --apply --publish           # add them published straight away
 *
 * Safe to run more than once. A spot is skipped when its district already has a place with the same name, or
 * one whose name contains the other ("Kuakata" and "Kuakata Sea Beach"); those are listed so you can check them.
 * The district (and its division) is created if it isn't there yet. Coordinates outside Bangladesh, or missing,
 * are left empty: add them in the admin panel (Destinations) before publishing.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', 'config.env') });
const Destination = require('../models/destinationModel');
const geo = require('../data/bangladesh');
const { ensureDistrict } = require('../utils/geography');
const { uniqueSlug } = require('../utils/destinations');
const database = require('../utils/database');
const { readXlsx } = require('../utils/xlsx');

const args = process.argv.slice(2);
const useDev = args.includes('--dev');
const apply = args.includes('--apply');
const publish = args.includes('--publish');
const files = args.filter(a => !a.startsWith('--'));

const databaseUri = () => {
  const raw = useDev ? process.env.DATABASE_DEV : process.env.DATABASE;
  if (!raw) throw new Error(`${useDev ? 'DATABASE_DEV' : 'DATABASE'} is not set in config.env.`);
  const uri = raw.replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''));
  // --dev must really be a development database
  if (useDev && database.devRefusal(uri)) throw new Error(database.devRefusal(uri));
  return uri;
};

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
const readSpots = () => {
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

const run = async () => {
  if (!files.length) {
    console.log('Give one or more .xlsx files: npm run import-spots -- ~/Downloads/spots.xlsx --dev');
    process.exit(1);
  }
  const { spots, problems } = readSpots();
  console.log(`Read ${spots.length} spots from ${files.length} file${files.length === 1 ? '' : 's'}.`);

  const uri = databaseUri();
  await mongoose.connect(uri);
  console.log(`Connected to ${database.describe(uri)}.`);
  console.log(`${apply ? 'Importing into' : 'Dry run on'} the ${useDev ? 'development' : 'PRODUCTION'} database${apply ? `, as ${publish ? 'published' : 'drafts'}` : ''}.\n`);

  const added = [];
  const skipped = [];
  const filled = [];
  const created = new Set();
  // Places already in each division (a spot near a border may be listed under the next district), plus
  // anything added during this run
  const existingIn = new Map();
  const placesIn = async divisionCode => {
    if (!existingIn.has(divisionCode)) {
      const division = await Destination.findOne({ geoCode: divisionCode }).select('_id').lean();
      existingIn.set(divisionCode, division ? await Destination.find({ ancestors: division._id, type: 'attraction' }).select('name nameBn summary slug status location').lean() : []);
    }
    return existingIn.get(divisionCode);
  };
  // A dry run must not create districts: look them up instead
  const districtNode = async spot => {
    if (apply) {
      // A district, division or country made here starts like the spots: a draft unless --publish
      const result = await ensureDistrict(spot.district.code, { status: publish ? 'published' : 'draft' });
      result.createdNames.forEach(n => created.add(n));
      return result.node;
    }
    return Destination.findOne({ geoCode: spot.district.code }).lean();
  };

  for (const spot of spots) {
    // eslint-disable-next-line no-await-in-loop
    const district = await districtNode(spot);
    // eslint-disable-next-line no-await-in-loop
    const nearby = await placesIn(spot.division.code);
    const same = nearby.find(p => looksSame(p.name, spot.name));
    if (same) {
      // A draft (not yet checked by the team) gets what it was missing: coordinates, Bangla name, summary
      const fill = {};
      if (same.status === 'draft' && same._id) {
        if (spot.lat != null && !(same.location && same.location.coordinates && same.location.coordinates.length)) fill.location = { type: 'Point', coordinates: [spot.lng, spot.lat] };
        if (spot.nameBn && !same.nameBn) fill.nameBn = spot.nameBn;
        if (spot.summary && !same.summary) fill.summary = spot.summary;
      }
      if (Object.keys(fill).length) {
        if (apply) {
          // eslint-disable-next-line no-await-in-loop
          await Destination.updateOne({ _id: same._id }, { $set: fill });
          Object.assign(same, fill);
        }
        filled.push({ spot, as: same, what: Object.keys(fill) });
      }
      skipped.push({ spot, as: same });
      continue;
    }
    if (!apply) {
      added.push(spot);
      nearby.push({ name: spot.name, note: `${spot.district.name}, earlier in this import` });
      if (!district) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await Destination.exists({ geoCode: geo.COUNTRY.code }))) created.add(`${geo.COUNTRY.name} (country)`);
        // eslint-disable-next-line no-await-in-loop
        if (!(await Destination.exists({ geoCode: spot.division.code }))) created.add(`${spot.division.name} (division)`);
        created.add(`${spot.district.name} (district)`);
      }
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const node = await Destination.create({
      name: spot.name,
      nameBn: spot.nameBn,
      type: 'attraction',
      // eslint-disable-next-line no-await-in-loop
      slug: await uniqueSlug(spot.name),
      parent: district._id,
      ancestors: [...(district.ancestors || []), district._id],
      summary: spot.summary,
      address: `${spot.district.name}, ${spot.division.name}`,
      ...(spot.lat != null ? { location: { type: 'Point', coordinates: [spot.lng, spot.lat] } } : {}),
      status: publish ? 'published' : 'draft',
      source: 'admin'
    });
    nearby.push({ _id: node._id, name: node.name, nameBn: node.nameBn, summary: node.summary, location: node.location, slug: node.slug, status: node.status, note: `${spot.district.name}, earlier in this import` });
    added.push(spot);
  }

  const noCoords = added.filter(s => s.lat == null).length;
  console.log(`${apply ? 'Added' : 'Would add'} ${added.length} attraction${added.length === 1 ? '' : 's'}${noCoords ? ` (${noCoords} without coordinates)` : ''}.`);
  if (created.size) console.log(`${apply ? 'Created' : 'Would also create'}, as ${publish ? 'published' : 'drafts'}: ${[...created].join(', ')}.`);
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} already there (the same place by name, in the same division):`);
    skipped.forEach(({ spot, as }) => console.log(`  ${spot.name} (${spot.district.name})  ~  ${as.name}${as.slug ? ` [${as.slug}]` : ''}${as.status ? `, ${as.status}` : ''}${as.note ? ` (${as.note})` : ''}`));
  }
  if (filled.length) {
    console.log(`\n${apply ? 'Filled in' : 'Would fill in'} what ${filled.length} draft${filled.length === 1 ? ' was' : 's were'} missing:`);
    filled.forEach(({ spot, as, what }) => console.log(`  ${as.name}: ${what.map(w => ({ location: 'coordinates', nameBn: 'Bangla name' }[w] || w)).join(', ')} (from ${spot.name})`));
  }
  if (problems.length) {
    console.log(`\nNeeds a look (${problems.length}):`);
    problems.forEach(p => console.log(`  ${p}`));
  }
  if (!apply) console.log('\nNothing was changed. Add --apply to import.');
  else if (!publish) console.log('\nThey are drafts: check them in the admin panel (Destinations) and publish.');
  await mongoose.disconnect();
};

run().catch(async err => {
  console.error('Import failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

