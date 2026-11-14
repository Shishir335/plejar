/**
 * Make Destinations hold only the tourist spots in the given .xlsx files: removes every other place.
 *
 * Kept:
 *   - each attraction that is a spot in the files (same name in the same division; see utils/touristSpots.js)
 *   - the district, division and country above each kept place, so filters and browsing by area work
 *   - any place a tour, booking, hotel, guide, ad, voucher or post still uses (and the places above it):
 *     deleting those would break them. They are listed so you can move them first if you want them gone.
 * Removed: everything else (other attractions, and districts or divisions with nothing kept inside).
 * Recently viewed entries and saved searches that pointed at a removed place lose that link.
 *
 *   npm run keep-only-spots -- file.xlsx [more.xlsx]           # dry run on the production database
 *   npm run keep-only-spots -- file.xlsx --dev                 # dry run on the development database
 *   npm run keep-only-spots -- file.xlsx --apply               # remove them (asks you to type the count first)
 *
 * Before --apply on production, take a backup (Atlas: Backup, or mongodump), as removed places can't be brought back.
 */
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', 'config.env') });
const Destination = require('../models/destinationModel');
const database = require('../utils/database');
const { looksSame, readSpots } = require('../utils/touristSpots');

const args = process.argv.slice(2);
const useDev = args.includes('--dev');
const apply = args.includes('--apply');
const files = args.filter(a => !a.startsWith('--'));

const databaseUri = () => {
  const raw = useDev ? process.env.DATABASE_DEV : process.env.DATABASE;
  if (!raw) throw new Error(`${useDev ? 'DATABASE_DEV' : 'DATABASE'} is not set in config.env.`);
  const uri = raw.replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''));
  if (useDev && database.devRefusal(uri)) throw new Error(database.devRefusal(uri));
  return uri;
};

// What can point at a place, and how it's shown when it does
const USES = [
  { collection: 'packages', label: 'tour', fields: ['destinationRef', 'itinerary.stops.destinationRef'], name: 'title' },
  { collection: 'bookings', label: 'booking', fields: ['destinationRef'], name: 'packageTitle' },
  { collection: 'hotels', label: 'hotel', fields: ['destination'], name: 'name' },
  { collection: 'guides', label: 'guide', fields: ['destination'], name: 'name' },
  { collection: 'promotions', label: 'ad', fields: ['destination'], name: 'title' },
  { collection: 'vouchers', label: 'voucher', fields: ['destination'], name: 'title' },
  { collection: 'posts', label: 'post', fields: ['place'], name: 'text' }
];

const ask = question => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
});

const run = async () => {
  if (!files.length) {
    console.log('Give the .xlsx file(s) whose spots to keep: npm run keep-only-spots -- ~/Downloads/spots.xlsx');
    process.exit(1);
  }
  const { spots } = readSpots(files);
  console.log(`Read ${spots.length} spots from ${files.length} file${files.length === 1 ? '' : 's'}.`);
  const uri = databaseUri();
  await mongoose.connect(uri);
  console.log(`Connected to ${database.describe(uri)}.`);
  console.log(`${apply ? 'Cleaning' : 'Dry run on'} the ${useDev ? 'development' : 'PRODUCTION'} database.\n`);
  const db = mongoose.connection.db;

  const all = await Destination.find().select('name type geoCode parent ancestors status').lean();
  const byId = new Map(all.map(d => [String(d._id), d]));
  const codeAbove = (d, type) => {
    const above = (d.ancestors || []).map(id => byId.get(String(id))).find(a => a && a.type === type);
    return above ? above.geoCode : null;
  };

  // 1. The spots: an attraction with the same name in the same division (as the import matches them: a
  // place near a border may sit under the next district)
  const keep = new Map(); // id -> why
  const missing = [];
  spots.forEach(spot => {
    const match = all.filter(d => d.type === 'attraction' && codeAbove(d, 'region') === spot.division.code && looksSame(d.name, spot.name));
    if (!match.length) missing.push(spot);
    match.forEach(d => keep.set(String(d._id), 'spot'));
  });

  // 2. Places something still uses
  const usedBy = new Map(); // id -> ['tour "Sajek 2 days"', ...]
  for (const use of USES) {
    for (const field of use.fields) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await db.collection(use.collection).find({ [field]: { $ne: null, $exists: true } }).project(field.startsWith('itinerary.') ? { itinerary: 1, [use.name]: 1 } : { [field]: 1, [use.name]: 1 }).toArray();
      rows.forEach(row => {
        const ids = field.startsWith('itinerary.')
          ? (row.itinerary || []).flatMap(day => (day.stops || []).map(s => s.destinationRef)).filter(Boolean)
          : [row[field]];
        ids.forEach(id => {
          const k = String(id);
          if (!byId.has(k)) return;
          const what = `${use.label} "${String(row[use.name] || row._id).slice(0, 50)}"`;
          usedBy.set(k, [...(usedBy.get(k) || []), what]);
        });
      });
    }
  }
  usedBy.forEach((uses, id) => { if (!keep.has(id)) keep.set(id, 'used'); });

  // 3. Everything above a kept place
  [...keep.keys()].forEach(id => {
    (byId.get(id).ancestors || []).forEach(a => { if (!keep.has(String(a)) && byId.has(String(a))) keep.set(String(a), 'above'); });
  });

  const remove = all.filter(d => !keep.has(String(d._id)));
  const count = type => remove.filter(d => d.type === type).length;
  const kept = type => all.filter(d => d.type === type && keep.has(String(d._id))).length;

  console.log(`Keeping ${keep.size} of ${all.length} places: ${kept('attraction')} attractions, ${kept('city')} districts, ${kept('region')} divisions, ${kept('country')} country.`);
  console.log(`${apply ? 'Removing' : 'Would remove'} ${remove.length}: ${count('attraction')} attractions, ${count('city')} districts, ${count('region')} divisions, ${count('country')} countries.`);
  const extraUsed = all.filter(d => keep.get(String(d._id)) === 'used');
  if (extraUsed.length) {
    console.log(`\nKept although not in the file, because something uses ${extraUsed.length === 1 ? 'it' : 'them'}:`);
    extraUsed.forEach(d => console.log(`  ${d.name} (${d.type}, ${d.status}): ${usedBy.get(String(d._id)).slice(0, 4).join(', ')}${usedBy.get(String(d._id)).length > 4 ? '…' : ''}`));
  }
  const removedAttractions = remove.filter(d => d.type === 'attraction');
  if (removedAttractions.length) {
    console.log(`\nAttractions ${apply ? 'removed' : 'that would be removed'}:`);
    removedAttractions.slice(0, 60).forEach(d => console.log(`  ${d.name} (${d.status})`));
    if (removedAttractions.length > 60) console.log(`  …and ${removedAttractions.length - 60} more`);
  }
  if (missing.length) {
    console.log(`\nIn the file but not found here (import them first: npm run import-spots): ${missing.length}`);
    missing.slice(0, 20).forEach(s => console.log(`  ${s.name} (${s.district.name})`));
  }

  if (!apply) {
    console.log('\nNothing was changed. Add --apply to remove them.');
    await mongoose.disconnect();
    return;
  }
  if (!remove.length) {
    console.log('\nNothing to remove.');
    await mongoose.disconnect();
    return;
  }
  const typed = process.env.CONFIRM_REMOVE || await ask(`\nType ${remove.length} to remove these ${remove.length} places for good: `);
  if (typed !== String(remove.length)) {
    console.log('Not confirmed. Nothing was changed.');
    await mongoose.disconnect();
    return;
  }
  const ids = remove.map(d => d._id);
  const gone = await Destination.deleteMany({ _id: { $in: ids } });
  // Loose links to removed places
  const views = await db.collection('recentviews').deleteMany({ kind: 'destination', item: { $in: ids } }).catch(() => ({ deletedCount: 0 }));
  const searches = await db.collection('toursearches').updateMany({ destination: { $in: ids } }, { $unset: { destination: '' } }).catch(() => ({ modifiedCount: 0 }));
  console.log(`\nRemoved ${gone.deletedCount} places. Cleared ${views.deletedCount} recently viewed entries and the place on ${searches.modifiedCount} saved searches.`);
  await mongoose.disconnect();
};

run().catch(async err => {
  console.error('Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
