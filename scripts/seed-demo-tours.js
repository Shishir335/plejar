/**
 * Demo content for the app's Tours tab on the DEVELOPMENT database: a guide, six upcoming tours
 * with itineraries, three hotels, a sale banner and reviews from five demo travelers.
 * Run seed-destinations first (the tours sit at its attractions and use its photos).
 *
 *   node scripts/seed-demo-tours.js --dev            # add the demo content (replaces an earlier run)
 *   node scripts/seed-demo-tours.js --dev --remove   # take all of it out again
 *
 * Everything it adds is tied to the demo travelers (demo.traveler.N@example.com) or marked
 * DEMO_MARK, so --remove deletes exactly that and nothing else. It never touches production.
 */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '..', 'config.env') });
const User = require('../models/userModel');
const Agency = require('../models/agencyModel');
const Destination = require('../models/destinationModel');
const Package = require('../models/packageModel');
const Guide = require('../models/guideModel');
const Hotel = require('../models/hotelModel');
const Promotion = require('../models/promotionModel');
const Booking = require('../models/bookingModel');
const Review = require('../models/reviewModel');
const Wishlist = require('../models/wishlistModel');
const Notification = require('../models/notificationModel');
const { ChatRoom, ChatMessage } = require('../models/chatModel');
const { removeChatFolder } = require('../utils/chatFiles');

const DEMO_MARK = 'plejar-demo-seed';
const DEMO_EMAIL = /^demo\.traveler\.\d+@example\.com$/;
const DAY = 86400000;

if (!process.argv.includes('--dev')) {
  console.error('Demo content only goes into the development database. Run with --dev.');
  process.exit(1);
}
const removeOnly = process.argv.includes('--remove');

const databaseUri = () => process.env.DATABASE_DEV.replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD || ''));

// Tour dates are stored as the calendar day at 00:00 UTC
const daysFromNow = n => {
  const d = new Date(Date.now() + n * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const REVIEWERS = ['Sarah Johnson', 'Nattha Srifatavee', 'Chatsuda Sucha', 'Saranya Kuntara', 'Piyanat Natakul'];
const REVIEW_TEXT = [
  'Everything was well organised from pickup to drop-off. The guide knew every trail and made sure the whole group was comfortable.',
  'Beautiful places and good food. The boats were a bit late on day two, but the team kept us updated the whole time.',
  'Our family loved it. The children still talk about the waterfall. Worth every taka.',
  'Great value for the price. Rooms were clean and the itinerary had enough free time to explore on our own.',
  'Friendly guide, safe transport and stunning views. I would book with this agency again.'
];

const removeDemo = async () => {
  const users = await User.find({ email: DEMO_EMAIL }).setOptions({ includeInactive: true }).select('_id');
  const ids = users.map(u => u._id);
  const tours = await Package.find({ createdBy: { $in: ids } }).select('_id');
  const tourIds = tours.map(t => t._id);
  // Their chats, with the messages and any photos or files sent in them
  const rooms = await ChatRoom.find({ $or: [{ 'members.user': { $in: ids } }, { tour: { $in: tourIds } }] }).select('_id');
  const roomIds = rooms.map(r => r._id);
  await ChatMessage.deleteMany({ room: { $in: roomIds } });
  await ChatRoom.deleteMany({ _id: { $in: roomIds } });
  await Promise.all(roomIds.map(removeChatFolder));
  const counts = await Promise.all([
    Review.deleteMany({ $or: [{ user: { $in: ids } }, { package: { $in: tourIds } }] }),
    Booking.deleteMany({ $or: [{ user: { $in: ids } }, { package: { $in: tourIds } }] }),
    Wishlist.deleteMany({ user: { $in: ids } }),
    Notification.deleteMany({ user: { $in: ids } }),
    Package.deleteMany({ _id: { $in: tourIds } }),
    Hotel.deleteMany({ createdBy: { $in: ids } }),
    Promotion.deleteMany({ createdBy: { $in: ids } }),
    Guide.deleteMany({ phone: DEMO_MARK }),
    User.deleteMany({ _id: { $in: ids } })
  ]);
  const [reviews, bookings, , , packages, hotels, promos, guides, people] = counts.map(c => c.deletedCount);
  console.log(`Removed ${roomIds.length} chats, ${packages} tours, ${hotels} hotels, ${promos} banners, ${guides} guides, ${reviews} reviews, ${bookings} bookings, ${people} demo travelers.`);
};

const place = async slug => {
  const d = await Destination.findOne({ slug, status: 'published' });
  if (!d) throw new Error(`Destination "${slug}" is missing. Run: npm run seed-destinations -- --dev --publish`);
  return d;
};

const day = (n, title, description, stops, meals = { breakfast: true, lunch: true, dinner: true }) => ({
  day: n,
  title,
  description,
  stops: stops.map(([time, placeName, kind = 'stop']) => ({ time, place: placeName, kind })),
  meals
});

const addDemo = async () => {
  const agency = await Agency.findOne({ status: 'active' });
  if (!agency) throw new Error('No active agency in the development database. Approve one in the admin panel first.');

  const travelers = [];
  for (const [i, name] of REVIEWERS.entries()) {
    const [firstName, lastName] = name.split(' ');
    travelers.push(await User.create({
      name, firstName, lastName,
      email: `demo.traveler.${i + 1}@example.com`,
      password: 'DemoPass123', confirmPassword: 'DemoPass123',
      role: 'user', authProvider: 'local'
    }));
  }
  const owner = travelers[0]._id;

  const guide = await Guide.create({
    agency: agency._id,
    name: 'Rahim Uddin',
    location: "Cox's Bazar, Bangladesh",
    languages: ['Bangla', 'English', 'Hindi'],
    experienceYears: 12,
    bio: 'Rahim has led groups through the hills of Bandarban and the islands of the Bay of Bengal for twelve years. He is a trained first-aider, knows the local communities well and makes sure every traveler gets the best view at sunrise.',
    phone: DEMO_MARK
  });

  const [nafakhum, sajek, coxs, tanguar, stMartin, sundarbans, sreemangal] = await Promise.all(
    ['nafakhum-falls', 'sajek-valley', 'coxs-bazar-sea-beach', 'tanguar-haor', 'saint-martins-island', 'sundarbans', 'sreemangal-tea-gardens'].map(place)
  );

  // Travelers can also hire the guide on their own ("Guide" in My Bookings)
  await Guide.updateOne({ _id: guide._id }, {
    bookable: true, title: 'Local Expert', pricePerDay: 1440, regularPrice: 1600, destination: coxs._id,
    ...(coxs.location && coxs.location.coordinates ? { mapLocation: { type: 'Point', coordinates: coxs.location.coordinates } } : {})
  });

  const base = {
    agency: agency._id, guide: guide._id, createdBy: owner, status: 'published', tourType: 'group',
    departureTime: '21:30', meetingPoint: 'Arambagh bus counter, Dhaka',
    highlights: ['Free breakfast available'],
    excluded: ['International flights', 'Travel insurance'],
    cancellationPolicy: 'Full refund up to 7 days before departure, 50% up to 3 days before.'
  };

  const tours = await Package.create([
    {
      ...base,
      title: 'Waterfall Journey',
      destinationRef: nafakhum._id, destination: nafakhum.name,
      description: 'Trek through the green hills of Bandarban to Nafakhum, the widest waterfall in Bangladesh. Paddle down the Sangu river, sleep in a Marma village and taste hill food cooked by local families.',
      photos: ['/img/places/nafakhum-falls.jpg', '/img/places/sajek-sunrise.jpg'],
      durationDays: 3, durationNights: 2, priceFrom: 1440, regularPrice: 1600,
      startDate: daysFromNow(12), endDate: daysFromNow(14), seats: 12, groupSize: { min: 2, max: 12 },
      tags: ['adventure', 'nature', 'hiking'], difficulty: 'moderate', flexibleDates: true,
      included: ['Professional English-speaking tour guide', '2 nights accommodation in a village guesthouse', 'All breakfasts, lunches and dinners', 'Boat ride on the Sangu river', 'Transportation from Dhaka and back'],
      itinerary: [
        day(1, 'Arrival in Bandarban & welcome dinner', 'Reach Bandarban in the morning, freshen up and drive to Thanchi along the hill road.', [['06:30', 'Bandarban bus stand', 'departure'], ['11:00', 'Thanchi ghat'], ['19:30', 'Welcome dinner', 'meal']]),
        day(2, 'Trek to Nafakhum Falls', 'A boat up the Sangu, then a three-hour trek through streams and forest to the falls.', [['07:00', 'Remakri by boat'], ['10:30', 'Nafakhum Falls', 'activity']]),
        day(3, 'Village morning and return', 'Sunrise in the village, then back to Bandarban for the night bus to Dhaka.', [['08:00', 'Marma village walk', 'activity'], ['21:30', 'Dhaka', 'return']], { breakfast: true, lunch: true, dinner: false })
      ]
    },
    {
      ...base,
      title: 'Mountain Landscape',
      destinationRef: sajek._id, destination: sajek.name,
      description: 'Among the eye-catching hills of Sajek, wake up above a sea of clouds. Remote and least populated, this is the quietest sunrise in the country.',
      photos: ['/img/places/sajek-sunrise.jpg'],
      durationDays: 2, durationNights: 1, priceFrom: 1440, regularPrice: 1600,
      startDate: daysFromNow(20), endDate: daysFromNow(21), seats: 15, groupSize: { min: 2, max: 15 },
      tags: ['hills', 'nature', 'photography'], difficulty: 'easy',
      included: ['Jeep from Khagrachari', '1 night in a hilltop cottage', 'All meals'],
      itinerary: [
        day(1, 'Khagrachari to Sajek', 'Jeep ride through army checkpoints and hill villages.', [['08:00', 'Khagrachari', 'departure'], ['13:00', 'Sajek Valley']]),
        day(2, 'Sunrise at Konglak Hill', 'Watch the clouds roll in, then head back.', [['05:15', 'Konglak Hill', 'activity'], ['21:00', 'Dhaka', 'return']])
      ]
    },
    {
      ...base,
      title: "Cox's Bazar 3 Night Tour",
      destinationRef: coxs._id, destination: coxs.name, tourType: 'family',
      description: 'Three relaxed nights by the longest natural sea beach in the world, with a day trip to Inani and Himchari.',
      photos: ['/img/places/coxs-bazar-sunset.jpg'],
      durationDays: 3, durationNights: 3, priceFrom: 1440, regularPrice: 1600,
      startDate: daysFromNow(30), endDate: daysFromNow(32), seats: 8, groupSize: { min: 2, max: 8 },
      tags: ['beach', 'relaxation', 'food'], difficulty: 'easy', flexibleDates: true,
      included: ['Sea-view hotel for 3 nights', 'Daily breakfast', 'Marine Drive day trip'],
      itinerary: [
        day(1, 'Arrive and sunset on the beach', 'Check in and walk to Laboni Point for sunset.', [['10:00', "Cox's Bazar", 'departure'], ['17:30', 'Laboni Point', 'activity']]),
        day(2, 'Marine Drive to Inani & Himchari', 'Rocky beaches, the waterfall at Himchari and fresh seafood.', [['09:00', 'Himchari'], ['12:00', 'Inani Beach']]),
        day(3, 'Free day and return', 'Shopping at Burmese market before the night bus.', [['21:00', 'Dhaka', 'return']])
      ]
    },
    {
      ...base,
      title: 'Tanguar Haor Houseboat',
      destinationRef: tanguar._id, destination: tanguar.name, tourType: 'group',
      description: 'Two days on a houseboat across the wetlands of Sunamganj, swimming in clear water under the Meghalaya hills.',
      photos: ['/img/places/tanguar-haor-houseboat.jpg', '/img/places/tanguar-haor-boat.jpg'],
      durationDays: 2, durationNights: 1, priceFrom: 3200,
      startDate: daysFromNow(16), endDate: daysFromNow(17), seats: 20, groupSize: { min: 4, max: 20 },
      tags: ['river', 'nature', 'relaxation'], difficulty: 'easy',
      included: ['Houseboat cabin', 'All meals on board', 'Life jackets'],
      itinerary: [
        day(1, 'Board at Tahirpur', 'Cruise across the haor to Watch Tower.', [['09:00', 'Tahirpur ghat', 'departure'], ['13:00', 'Watch Tower', 'activity']]),
        day(2, 'Niladri Lake & return', 'Blue lake, limestone hills and the ride home.', [['09:00', 'Niladri Lake'], ['20:00', 'Sunamganj', 'return']])
      ]
    },
    {
      ...base,
      title: "Saint Martin's Island Escape",
      destinationRef: stMartin._id, destination: stMartin.name, tourType: 'couple',
      description: 'Ship from Teknaf to the only coral island in Bangladesh. Cycle around the island and watch the stars from Chhera Dwip.',
      photos: ['/img/places/saint-martins-island.jpg'],
      durationDays: 3, durationNights: 2, priceFrom: 4800, regularPrice: 6000,
      startDate: daysFromNow(40), endDate: daysFromNow(42), seats: 10, groupSize: { min: 2, max: 10 },
      tags: ['island', 'beach', 'relaxation'], difficulty: 'easy',
      included: ['Ship tickets', 'Beach resort for 2 nights', 'Breakfast and dinner'],
      itinerary: [
        day(1, 'Ship to the island', 'Morning ship from Teknaf.', [['09:30', 'Teknaf jetty', 'departure'], ['13:00', "Saint Martin's Island"]]),
        day(2, 'Chhera Dwip by boat', 'The southern tip at low tide.', [['08:00', 'Chhera Dwip', 'activity']]),
        day(3, 'Return to Teknaf', 'Afternoon ship back.', [['15:00', 'Teknaf', 'return']])
      ]
    },
    {
      ...base,
      title: 'Sundarbans Wildlife Cruise',
      destinationRef: sundarbans._id, destination: sundarbans.name, tourType: 'private',
      description: 'Three days on the rivers of the largest mangrove forest on earth, looking for deer, crocodiles and, with luck, the Bengal tiger.',
      photos: ['/img/places/sundarbans-canal.jpg', '/img/places/sreemangal-tea-garden.jpg'],
      durationDays: 3, durationNights: 2, priceFrom: 8500,
      startDate: daysFromNow(55), endDate: daysFromNow(57), seats: 12, groupSize: { min: 2, max: 12 },
      tags: ['wildlife', 'river', 'adventure'], difficulty: 'moderate',
      included: ['Cruise ship cabin', 'Forest permits and armed guard', 'All meals'],
      itinerary: [
        day(1, 'Khulna to Harbaria', 'Board the ship and enter the forest.', [['07:00', 'Khulna launch ghat', 'departure'], ['15:00', 'Harbaria', 'activity']]),
        day(2, 'Kotka and Kochikhali', 'Walks on wooden trails and a beach on the bay.', [['06:00', 'Kotka'], ['14:00', 'Kochikhali beach']]),
        day(3, 'Karamjal and back', 'Crocodile breeding centre and return to Khulna.', [['10:00', 'Karamjal'], ['18:00', 'Khulna', 'return']])
      ]
    }
  ]);

  // Reviews on the first tour, each from a completed booking (one review per booking)
  const waterfall = tours[0];
  for (const [i, traveler] of travelers.entries()) {
    const booking = await Booking.create({
      user: traveler._id, kind: 'tour', agency: agency._id, package: waterfall._id,
      packageTitle: waterfall.title, destination: waterfall.destination, destinationRef: waterfall.destinationRef,
      travelDate: daysFromNow(-60 - i * 7), travelers: 1, pricePerPerson: waterfall.priceFrom, amount: waterfall.priceFrom,
      commissionRate: 10, commissionAmount: Math.round(waterfall.priceFrom * 0.1),
      status: 'completed', paymentStatus: 'paid', completedAt: daysFromNow(-58 - i * 7)
    });
    await Review.create({ user: traveler._id, agency: agency._id, package: waterfall._id, guide: guide._id, booking: booking._id, rating: i === 1 ? 4 : 5, comment: REVIEW_TEXT[i] });
  }

  const hotelAt = (dest, extra) => ({
    destination: dest._id, status: 'published', featured: true, createdBy: owner, type: 'resort',
    highlights: ['Free breakfast available'], amenities: ['Wi-Fi', 'Air conditioning', 'Restaurant'],
    location: dest.location && dest.location.coordinates ? { type: 'Point', coordinates: dest.location.coordinates } : undefined,
    ...extra
  });
  const hotels = await Hotel.create([
    hotelAt(tanguar, { name: 'Haor View Resort', description: 'Lorem ipsum dolor sit amet consectetur. Tincidunt felis consequat mauris arcu egestas.', photos: ['/img/places/tanguar-haor-boat.jpg'], pricePerNight: 1440, regularPrice: 1600, starRating: 3, rating: { average: 4.9, count: 120, source: 'Google' } }),
    hotelAt(sreemangal, { name: 'Tea Garden Cottage', description: 'Among the eye-catching tea estates, remote and least populated.', photos: ['/img/places/sreemangal-tea-garden.jpg'], pricePerNight: 2200, regularPrice: 2600, starRating: 4, rating: { average: 4.7, count: 86, source: 'Google' } }),
    hotelAt(coxs, { name: 'Grand Horizon Hotel', type: 'hotel', description: 'Sea-facing rooms a short walk from Laboni Point.', photos: ['/img/places/coxs-bazar-sunset.jpg'], pricePerNight: 3500, starRating: 4, rating: { average: 4.6, count: 240, source: 'Google' } })
  ]);

  await Promotion.create({
    title: 'Summer Adventure Sale', subtitle: 'Up to 30% Off on selected tours', highlight: '30% Off',
    image: '/img/places/ratargul-boat.jpg', target: 'sale_tours', minDiscount: 5, order: 0, createdBy: owner
  });
  // A vendor's accepted ad, so the slides have a sponsored one that opens its tour
  const adTour = tours.find(t => t.title === "Cox's Bazar 3 Night Tour");
  await Promotion.create({
    title: "Cox's Bazar Getaway", subtitle: 'Save 10% on 3 nights by the sea', highlight: '10%', ctaLabel: 'View Tour',
    image: '/img/places/coxs-bazar-sunset.jpg', target: 'tours', tours: [adTour._id], order: 1, createdBy: owner,
    source: 'vendor', tour: adTour._id, agency: agency._id, reviewStatus: 'approved', reviewedAt: new Date()
  });

  // My Bookings for the first demo traveler: a tour, a hotel and a guide
  const coxsTour = tours.find(t => t.title === "Cox's Bazar 3 Night Tour");
  const grand = hotels.find(h => h.name === 'Grand Horizon Hotel');
  const me = travelers[0]._id;
  await Booking.create([
    {
      user: me, kind: 'tour', agency: agency._id, package: coxsTour._id, packageTitle: coxsTour.title,
      destination: coxsTour.destination, destinationRef: coxsTour.destinationRef,
      travelDate: coxsTour.startDate, endDate: coxsTour.endDate, travelers: 2,
      pricePerPerson: coxsTour.priceFrom, regularPrice: coxsTour.regularPrice > coxsTour.priceFrom ? coxsTour.regularPrice : null,
      amount: coxsTour.priceFrom * 2, commissionRate: 10, commissionAmount: Math.round(coxsTour.priceFrom * 0.2),
      status: 'confirmed', confirmedAt: new Date()
    },
    {
      user: me, kind: 'hotel', hotel: grand._id, packageTitle: grand.name, destination: "Cox's Bazar, Bangladesh", destinationRef: coxs._id,
      travelDate: daysFromNow(20), endDate: daysFromNow(25), travelers: 2, rooms: 1, units: 5,
      pricePerPerson: grand.pricePerNight, amount: grand.pricePerNight * 5, commissionRate: 0, commissionAmount: 0,
      status: 'confirmed', confirmedAt: new Date()
    },
    {
      user: me, kind: 'guide', agency: agency._id, guide: guide._id, packageTitle: 'Rahim Uddin - Local Expert',
      destination: guide.location, destinationRef: coxs._id, travelDate: daysFromNow(21), endDate: daysFromNow(23),
      travelers: 2, units: 3, pricePerPerson: 1440, regularPrice: 1600, amount: 1440 * 3,
      commissionRate: 10, commissionAmount: Math.round(1440 * 0.3)
    }
  ]);

  // A second traveler on the same tour, so its group chat has two people
  await Booking.create({
    user: travelers[1]._id, kind: 'tour', agency: agency._id, package: coxsTour._id, packageTitle: coxsTour.title,
    destination: coxsTour.destination, destinationRef: coxsTour.destinationRef,
    travelDate: coxsTour.startDate, endDate: coxsTour.endDate, travelers: 1,
    pricePerPerson: coxsTour.priceFrom, amount: coxsTour.priceFrom, commissionRate: 10, commissionAmount: Math.round(coxsTour.priceFrom * 0.1),
    status: 'confirmed', confirmedAt: new Date()
  });

  // Their wishlist and a few notifications (insertMany skips the push the model sends on save)
  const sundarbansTour = tours.find(t => t.title === 'Sundarbans Wildlife Cruise');
  await Wishlist.create([
    { user: me, kind: 'tour', item: coxsTour._id },
    { user: me, kind: 'tour', item: sundarbansTour._id },
    { user: me, kind: 'hotel', item: grand._id }
  ]);
  const hoursAgo = h => new Date(Date.now() - h * 60 * 60 * 1000);
  await Notification.insertMany([
    { user: me, agency: agency._id, kind: 'event_changed', event: coxsTour._id, title: 'Tour Schedule Change', body: `${coxsTour.title} now leaves Dhaka at 10:30 PM instead of 9:30 PM.`, createdAt: hoursAgo(2) },
    { user: me, kind: 'trip_reminder', title: 'Hotel Check-in Information', body: 'Your room at Grand Horizon Hotel will be ready for check-in at 2:00 PM. Early check-in is available on request.', createdAt: hoursAgo(5) },
    { user: me, agency: agency._id, kind: 'booking_confirmed', event: coxsTour._id, title: 'Booking Confirmed', body: `Your booking for ${coxsTour.title} is confirmed.`, createdAt: hoursAgo(26), readAt: hoursAgo(20) },
    { user: me, kind: 'points_earned', title: 'You earned 1,440 points', body: 'Thanks for travelling with Plejar. Your points are in Voucher & Rewards.', createdAt: hoursAgo(72), readAt: hoursAgo(70) }
  ]);

  console.log(`Added ${tours.length} tours, 3 hotels, 2 banners, 1 guide and ${travelers.length} reviews for agency "${agency.name}".`);
  console.log('demo.traveler.1@example.com also has bookings, a wishlist and notifications.');
  console.log('Demo travelers sign in as demo.traveler.1@example.com ... demo.traveler.5@example.com, password DemoPass123.');
};

(async () => {
  await mongoose.connect(databaseUri());
  console.log('Plejar demo tours — DEVELOPMENT (plezar_dev) database');
  try {
    await removeDemo();
    if (!removeOnly) await addDemo();
  } finally {
    await mongoose.disconnect();
  }
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
