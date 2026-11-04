/**
 * Puts the agency back on vendor ads that lost it: saving one through the admin Banners form used to
 * blank the field, which hides the ad from its vendor's Tour ads list. The agency is taken from the
 * ad's tour. Only that one field changes.
 *   node scripts/repair-ad-agencies.js --dev                     # show what would change
 *   node scripts/repair-ad-agencies.js --dev --apply             # change it
 *   node scripts/repair-ad-agencies.js --production [--apply]    # the same on the live database
 */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', 'config.env') });
const Promotion = require('../models/promotionModel');
const Package = require('../models/packageModel');

const dev = process.argv.includes('--dev');
const live = process.argv.includes('--production');
const apply = process.argv.includes('--apply');
if (dev === live) {
  console.error('Say which database: --dev or --production.');
  process.exit(1);
}

(async () => {
  const uri = live ? process.env.DATABASE : process.env.DATABASE_DEV;
  await mongoose.connect(uri.replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || '')), { autoIndex: false });
  console.log(`Database: ${mongoose.connection.name}${apply ? '' : ' (nothing will be changed)'}`);
  const ads = await Promotion.find({ source: 'vendor', $or: [{ agency: null }, { agency: { $exists: false } }] }).select('title tour').lean();
  console.log(`${ads.length} vendor ad(s) with no agency.`);
  for (const ad of ads) {
    const tour = await Package.findById(ad.tour).select('title agency').lean();
    if (!tour || !tour.agency) {
      console.log(`Skipped "${ad.title}": its tour or the tour's agency is gone.`);
    } else {
      // Directly on the collection, so the ad's "last updated" time stays as it is
      if (apply) await Promotion.collection.updateOne({ _id: ad._id }, { $set: { agency: tour.agency } });
      console.log(`${apply ? 'Repaired' : 'Would repair'} "${ad.title}" (${tour.title}) with agency ${tour.agency}.`);
    }
  }
  await mongoose.disconnect();
})().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
