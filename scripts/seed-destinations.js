/**
 * Add a starter set of Bangladesh destinations: the country, its 8 divisions, some districts and
 * well-known attractions, plus destination categories. Places that already exist (same web address)
 * are left alone, so it is safe to run more than once.
 *
 *   npm run seed-destinations                       # production database, everything as drafts
 *   npm run seed-destinations -- --dev              # development database
 *   npm run seed-destinations -- --dev --publish    # publish them straight away
 *
 * Coordinates are approximate and the text is a starting point: check both in the admin panel
 * (Destinations) before publishing. Cover photos are the Wikimedia Commons images in /img/places,
 * credited to their photographers.
 */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', 'config.env') });
const Destination = require('../models/destinationModel');
const DestinationCategory = require('../models/destinationCategoryModel');

const useDev = process.argv.includes('--dev');
const publish = process.argv.includes('--publish');

const databaseUri = () => {
  const raw = useDev ? process.env.DATABASE_DEV : process.env.DATABASE;
  if (!raw) throw new Error(`${useDev ? 'DATABASE_DEV' : 'DATABASE'} is not set in config.env.`);
  return raw.replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''));
};

const CATEGORIES = [
  ['Beaches and islands', 'সৈকত ও দ্বীপ'],
  ['Hills and valleys', 'পাহাড় ও উপত্যকা'],
  ['Waterfalls', 'ঝর্ণা'],
  ['Forests and wildlife', 'বন ও বন্যপ্রাণী'],
  ['Haor and wetlands', 'হাওর ও জলাভূমি'],
  ['Tea gardens', 'চা বাগান'],
  ['Rivers and lakes', 'নদী ও হ্রদ'],
  ['Heritage and history', 'ঐতিহ্য ও ইতিহাস']
];

const photo = (file, caption, credit) => ({ url: `/img/places/${file}`, caption, credit });

// [slug, name, nameBn, type, parentSlug, lat, lng, extra]
const PLACES = [
  ['bangladesh', 'Bangladesh', 'বাংলাদেশ', 'country', null, 23.685, 90.3563, { summary: 'Hills, haor, tea gardens, mangrove forest and the longest natural sea beach, in a country you can cross in a night bus.' }],

  ['dhaka-division', 'Dhaka', 'ঢাকা', 'region', 'bangladesh', 23.8103, 90.4125],
  ['chattogram-division', 'Chattogram', 'চট্টগ্রাম', 'region', 'bangladesh', 22.3569, 91.7832, { summary: 'The hill tracts of Rangamati and Bandarban, and the sea at Cox’s Bazar.' }],
  ['sylhet-division', 'Sylhet', 'সিলেট', 'region', 'bangladesh', 24.8949, 91.8687, { summary: 'Tea gardens, swamp forest, stone rivers and the haor of Sunamganj.' }],
  ['khulna-division', 'Khulna', 'খুলনা', 'region', 'bangladesh', 22.8456, 89.5403, { summary: 'Gateway to the Sundarbans.' }],
  ['barishal-division', 'Barishal', 'বরিশাল', 'region', 'bangladesh', 22.701, 90.3535, { summary: 'Rivers, floating markets and the beach at Kuakata.' }],
  ['rajshahi-division', 'Rajshahi', 'রাজশাহী', 'region', 'bangladesh', 24.3745, 88.6042],
  ['rangpur-division', 'Rangpur', 'রংপুর', 'region', 'bangladesh', 25.7439, 89.2752],
  ['mymensingh-division', 'Mymensingh', 'ময়মনসিংহ', 'region', 'bangladesh', 24.7471, 90.4203],

  ['rangamati', 'Rangamati', 'রাঙামাটি', 'city', 'chattogram-division', 22.6533, 92.1753],
  ['bandarban', 'Bandarban', 'বান্দরবান', 'city', 'chattogram-division', 22.1953, 92.2184],
  ['coxs-bazar', 'Cox’s Bazar', 'কক্সবাজার', 'city', 'chattogram-division', 21.4272, 92.0058],
  ['sylhet', 'Sylhet', 'সিলেট', 'city', 'sylhet-division', 24.8949, 91.8687],
  ['sunamganj', 'Sunamganj', 'সুনামগঞ্জ', 'city', 'sylhet-division', 25.0658, 91.395],
  ['moulvibazar', 'Moulvibazar', 'মৌলভীবাজার', 'city', 'sylhet-division', 24.4829, 91.7774],
  ['khulna', 'Khulna', 'খুলনা', 'city', 'khulna-division', 22.8456, 89.5403],
  ['patuakhali', 'Patuakhali', 'পটুয়াখালী', 'city', 'barishal-division', 22.3596, 90.3299],

  ['sajek-valley', 'Sajek Valley', 'সাজেক ভ্যালি', 'attraction', 'rangamati', 23.382, 92.2938, {
    categories: ['Hills and valleys'],
    summary: 'A ridge-top village in the Rangamati hills, famous for sunrise above a sea of clouds.',
    description: 'Sajek sits high on a ridge near the Mizoram border. Most travelers take a night bus to Khagrachari, then a shared jeep up the winding hill road. Cottages line the main street, and the walk up Konglak hill at dawn is the reason most people come.',
    highlights: ['Sunrise over the clouds from Konglak hill', 'Cottages with a view over the hills', 'Jeep ride through the hill road from Khagrachari'],
    howToGetThere: 'Night bus from Dhaka to Khagrachari, then a jeep (chander gari) to Sajek, usually with an army escort at set times.',
    travelTips: 'Carry your national ID for checkpoints. Mobile signal is weak, and cottages fill up on weekends, so book ahead.',
    bestMonths: [9, 10, 11, 12, 1, 2],
    gallery: [photo('sajek-sunrise.jpg', 'Sunrise at Sajek Valley', 'Rocky Masum, CC BY-SA 4.0, via Wikimedia Commons')]
  }],
  ['nafakhum-falls', 'Nafakhum Falls', 'নাফাখুম জলপ্রপাত', 'attraction', 'bandarban', 21.7136, 92.5217, {
    categories: ['Waterfalls', 'Hills and valleys'],
    summary: 'One of the largest waterfalls in Bangladesh, deep in the Bandarban hills past Remakri.',
    description: 'Nafakhum is reached by boat up the Sangu river from Thanchi to Remakri, then a walk along the stream. The trip usually takes two to three days with a registered local guide.',
    highlights: ['Boat ride up the Sangu river', 'Walking the stream from Remakri', 'Nights in a Marma village'],
    howToGetThere: 'Bus to Bandarban, road to Thanchi, then boat to Remakri and a walk of a few hours. A registered guide is required.',
    travelTips: 'Boats may not run when the river is too high or too low. Wear shoes that grip on wet rock.',
    bestMonths: [9, 10, 11],
    gallery: [photo('nafakhum-falls.jpg', 'Nafakhum Falls', 'Abu Md. Jakaria, public domain, via Wikimedia Commons')]
  }],
  ['coxs-bazar-sea-beach', 'Cox’s Bazar Sea Beach', 'কক্সবাজার সমুদ্র সৈকত', 'attraction', 'coxs-bazar', 21.4285, 91.9702, {
    categories: ['Beaches and islands'],
    summary: 'One of the longest natural sandy beaches in the world, running south toward Teknaf.',
    highlights: ['Sunset at Laboni and Sugandha points', 'The Marine Drive road to Teknaf', 'Fresh seafood by the beach'],
    bestMonths: [11, 12, 1, 2, 3],
    gallery: [photo('coxs-bazar-sunset.jpg', 'Sunset at Cox’s Bazar', 'Tanweer Morshed, CC BY-SA 3.0, via Wikimedia Commons')]
  }],
  ['saint-martins-island', 'Saint Martin’s Island', 'সেন্টমার্টিন দ্বীপ', 'attraction', 'coxs-bazar', 20.6237, 92.3234, {
    categories: ['Beaches and islands'],
    summary: 'The country’s only coral island, a few hours by boat from Teknaf.',
    bestMonths: [11, 12, 1],
    availability: { status: 'seasonal', openMonths: [11, 12, 1], note: 'Visits are limited by government rules to the winter season, with a daily cap on visitors. Check the current rules before planning.' },
    gallery: [photo('saint-martins-island.jpg', 'Saint Martin’s Island', 'Niaz Morshed Shovon, public domain, via Wikimedia Commons')]
  }],
  ['ratargul-swamp-forest', 'Ratargul Swamp Forest', 'রাতারগুল জলাবন', 'attraction', 'sylhet', 25.0083, 91.9472, {
    categories: ['Forests and wildlife'],
    summary: 'A freshwater swamp forest near Sylhet, explored by small boat when the water is high.',
    bestMonths: [6, 7, 8, 9, 10],
    gallery: [
      photo('ratargul-boat.jpg', 'By boat through Ratargul', 'Sumon Mallick, CC BY-SA 4.0, via Wikimedia Commons'),
      photo('ratargul-morning.jpg', 'Ratargul in the morning', 'Nawas Sharif, CC BY-SA 4.0, via Wikimedia Commons')
    ]
  }],
  ['jaflong', 'Jaflong', 'জাফলং', 'attraction', 'sylhet', 25.1636, 92.0177, {
    categories: ['Rivers and lakes', 'Tea gardens'],
    summary: 'Clear water and stones on the Piyain river, under the hills on the Meghalaya border.',
    bestMonths: [6, 7, 8, 9, 10, 11],
    gallery: [photo('jaflong-tea-garden.jpg', 'Tea garden at Jaflong', 'Abdul Momin, CC BY-SA 4.0, via Wikimedia Commons')]
  }],
  ['tanguar-haor', 'Tanguar Haor', 'টাঙ্গুয়ার হাওর', 'attraction', 'sunamganj', 25.145, 91.067, {
    categories: ['Haor and wetlands'],
    summary: 'A vast wetland in Sunamganj where houseboats spend the night on the water in the monsoon.',
    bestMonths: [6, 7, 8, 9, 10, 12, 1],
    gallery: [
      photo('tanguar-haor-houseboat.jpg', 'Houseboat on Tanguar Haor', 'Ahnaf Tahmid Manan, CC BY-SA 4.0, via Wikimedia Commons'),
      photo('tanguar-haor-boat.jpg', 'Crossing Tanguar Haor by boat', 'Ahnaf Tahmid Manan, CC BY-SA 4.0, via Wikimedia Commons')
    ]
  }],
  ['sreemangal-tea-gardens', 'Sreemangal tea gardens', 'শ্রীমঙ্গলের চা বাগান', 'attraction', 'moulvibazar', 24.3065, 91.7296, {
    categories: ['Tea gardens', 'Forests and wildlife'],
    summary: 'Rolling tea estates around the country’s tea capital, with Lawachara forest nearby.',
    bestMonths: [6, 7, 8, 9, 10, 11, 12],
    gallery: [photo('sreemangal-tea-garden.jpg', 'Tea garden in Sreemangal', 'Kritzolina, CC BY-SA 4.0, via Wikimedia Commons')]
  }],
  ['sundarbans', 'Sundarbans', 'সুন্দরবন', 'attraction', 'khulna', 21.9497, 89.1833, {
    categories: ['Forests and wildlife', 'Rivers and lakes', 'Heritage and history'],
    summary: 'The largest mangrove forest in the world and home of the Royal Bengal tiger, seen by boat from Khulna or Mongla.',
    bestMonths: [11, 12, 1, 2],
    availability: { status: 'restricted', openMonths: [], note: 'Entry needs a Forest Department permit, normally arranged by your tour operator.' },
    gallery: [photo('sundarbans-canal.jpg', 'A canal in the Sundarbans', 'Hrihu Raiyan Khan, CC BY-SA 4.0, via Wikimedia Commons')]
  }],
  ['kuakata', 'Kuakata', 'কুয়াকাটা', 'attraction', 'patuakhali', 21.8167, 90.1167, {
    categories: ['Beaches and islands'],
    summary: 'A long beach on the Bay of Bengal where you can watch both sunrise and sunset over the sea.',
    bestMonths: [11, 12, 1, 2]
  }]
];

(async () => {
  try {
    console.log(`\nPlezar starter destinations — ${useDev ? 'DEVELOPMENT (plezar_dev)' : 'PRODUCTION'} database, ${publish ? 'published' : 'as drafts'}\n`);
    await mongoose.connect(databaseUri(), { serverSelectionTimeoutMS: 10000 });

    const categories = await Promise.all(CATEGORIES.map(([name, nameBn]) =>
      DestinationCategory.findOneAndUpdate({ name }, { $setOnInsert: { name, nameBn } }, { upsert: true, new: true })));
    const categoryIds = new Map(categories.map(c => [c.name, c._id]));

    let added = 0;
    let skipped = 0;
    const bySlug = new Map();
    const addPlace = async ([slug, name, nameBn, type, parentSlug, lat, lng, extra = {}]) => {
      let dest = await Destination.findOne({ slug });
      if (dest) {
        skipped += 1;
      } else {
        const parent = parentSlug ? bySlug.get(parentSlug) : null;
        const gallery = extra.gallery || [];
        dest = await Destination.create({
          slug,
          name,
          nameBn,
          type,
          parent: parent ? parent._id : null,
          ancestors: parent ? [...parent.ancestors, parent._id] : [],
          location: { type: 'Point', coordinates: [lng, lat] },
          summary: extra.summary || '',
          description: extra.description || '',
          highlights: extra.highlights || [],
          howToGetThere: extra.howToGetThere || '',
          travelTips: extra.travelTips || '',
          bestMonths: extra.bestMonths || [],
          categories: (extra.categories || []).map(c => categoryIds.get(c)).filter(Boolean),
          gallery,
          coverImage: gallery.length ? gallery[0].url : '',
          availability: extra.availability || { status: 'open', openMonths: [], note: '' },
          status: publish ? 'published' : 'draft'
        });
        added += 1;
      }
      bySlug.set(slug, dest);
    };
    // One at a time: parents come before their places in the list, so each parent exists first
    await PLACES.reduce((chain, place) => chain.then(() => addPlace(place)), Promise.resolve());

    console.log(`Done: ${added} destination${added === 1 ? '' : 's'} added, ${skipped} already there. ${CATEGORIES.length} categories ready.`);
    if (!publish && added) console.log('They are drafts: review them in the admin panel (Destinations) and publish when ready.');
  } catch (err) {
    console.error(`\nCould not add the destinations: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
