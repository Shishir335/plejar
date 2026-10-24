/**
 * Plezar showcase page - English / Bangla language switcher
 *
 * English lives in the HTML and is the default. Elements opt in with:
 *   data-i18n="key"            replace text
 *   data-i18n-html="key"       replace inner HTML (for strings with <strong>, <span> etc.)
 *   data-i18n-attr="alt:key"   replace attributes (comma-separated attr:key pairs)
 * Bangla strings live in BN below. Strings used from JavaScript live in MESSAGES.
 */

const LANG_KEY = 'plezar_lang';

const BN = {
  metaTitle: 'Plezar — বাংলাদেশ, যারা ঘুরে বেড়ান তাদের চোখে',
  metaDescription: 'Plezar বাংলাদেশে ভ্রমণের একটি সামাজিক অ্যাপ। ভ্রমণকারীরা তাদের ট্রিপ শেয়ার করেন, স্থানীয় ট্যুর এজেন্টরা তাদের কাজ তুলে ধরেন, আর সবাই আসল ছবি ও সৎ রিভিউ দেখে পরিকল্পনা করেন।',

  skip: 'মূল অংশে যান',
  logoLabel: 'Plezar হোম',
  menuLabel: 'মেনু',
  navApp: 'অ্যাপ',
  navFeatures: 'ফিচার',
  navPlaces: 'জায়গা',
  navTravelers: 'ভ্রমণকারীদের জন্য',
  navAgents: 'এজেন্টদের জন্য',
  navCta: 'আপডেট পান',

  heroTitle: 'বাংলাদেশ, যারা ঘুরে বেড়ান তাদের চোখে।',
  heroText: 'Plezar বাংলাদেশে ভ্রমণের একটি সামাজিক অ্যাপ। ভ্রমণকারীরা তাদের ট্রিপ শেয়ার করেন, স্থানীয় ট্যুর এজেন্টরা তাদের কাজ তুলে ধরেন, আর সবাই আসল ছবি ও সৎ রিভিউ দেখে পরের ট্রিপের পরিকল্পনা করেন।',
  heroCta1: 'অ্যাপটি কী করে দেখুন',
  heroCta2: 'প্রজেক্টের খবর রাখুন',
  heroPlace: 'পাহাড়ের কোলে চা বাগান',
  altJaflong: 'জাফলং, সিলেটের পাহাড়ি চা বাগানে কাজ করছেন চা শ্রমিকরা, পেছনে কুয়াশাঢাকা পাহাড়',

  whatTitle: 'বাংলাদেশে ঘোরার মতো সব জায়গা, এক জায়গায়',
  whatLead: 'এখন ট্রিপের আইডিয়া ছড়িয়ে আছে ফেসবুক গ্রুপ, ইউটিউব ভ্লগ আর বন্ধুদের ছবির অ্যালবামে। ট্যুর এজেন্টরা শত শত গ্রুপে পোস্ট দেন আর আশা করেন কেউ দেখবে। Plezar দুটোকেই এক ফিডে নিয়ে আসে।',
  factTravelersTitle: 'ভ্রমণকারীদের জন্য',
  factTravelersText: 'আসল ট্রিপের মাধ্যমে নতুন জায়গা খুঁজুন, পছন্দের এজেন্টদের ফলো করুন, আর পরের গন্তব্যের পরিকল্পনা গুছিয়ে রাখুন।',
  factAgentsTitle: 'ট্যুর এজেন্টদের জন্য',
  factAgentsText: 'আগের ট্রিপ, ছবি আর রিভিউ দিয়ে নিজের প্রোফাইল তৈরি করুন, যাতে কল করার আগেই মানুষ আপনাকে চিনতে পারে।',
  phoneLabel: 'Plezar অ্যাপের ফিড',
  appFollowing: 'ফলো করছেন',
  appNearby: 'কাছাকাছি',
  placeSajek: 'সাজেক ভ্যালি',
  altSajek: 'সাজেকে মেঘে ঢাকা উপত্যকার ওপর সূর্যোদয়',
  appPost: '<b>১,২০৪ লাইক</b> আজ ভোর ৫:৪০-এ উপত্যকায় মেঘ নেমে এসেছিল। আমাদের ১৮ জনের দল কংলাক পাড়া থেকে দেখেছে।',

  featuresTitle: 'Plezar-এ আপনি যা করতে পারবেন',
  f1Title: 'ট্রাভেল ফিডে ট্রিপ শেয়ার করুন',
  f1Text: 'যেখানেই থাকুন, ছবি, ভিডিও আর ছোট নোট পোস্ট করুন। প্রতিটি পোস্টে জায়গা ট্যাগ করা থাকে, তাই ফিডটা হয়ে ওঠে বাংলাদেশের এক জীবন্ত মানচিত্র: এই সপ্তাহে রাতারগুল কেমন দেখাচ্ছে, হাওরে পানি কতটা, সাজেকের রাস্তা খোলা কিনা।',
  f1Li1: 'যাদের ট্রিপ ভালো লাগে, সেই ভ্রমণকারী ও এজেন্টদের ফলো করুন',
  f1Li2: 'পোস্টে লাইক ও কমেন্ট দিন, পরে দেখার জন্য সেভ করুন',
  f1Li3: 'জায়গা, ঋতু বা ট্রিপের ধরন অনুযায়ী খুঁজুন',
  altRatargulBoat: 'রাতারগুল জলাবনের ডুবে থাকা সবুজ গাছের মধ্য দিয়ে চলছে একটি কাঠের নৌকা',
  f1Overlay: '<strong>নুসরাত রহমান</strong> আছেন <strong>রাতারগুল জলাবনে</strong><small>এখন পানি অনেক আর স্বচ্ছ। আগস্টের আগেই যান।</small>',

  f2Title: 'কল করার আগে এজেন্ট সম্পর্কে জানুন',
  f2Text: 'প্রত্যেক ট্যুর এজেন্টের একটি প্রোফাইল থাকে, যেখানে তাদের পরিচালিত ট্রিপ, সেসব ট্রিপের ছবি আর যারা গেছেন তাদের রিভিউ থাকে। যেসব এজেন্ট ট্রেড লাইসেন্স ও জাতীয় পরিচয়পত্র দেখান, তারা ভেরিফায়েড চিহ্ন পান।',
  f2Li1: 'শুধু বিজ্ঞাপন নয়, এজেন্টের আগের ট্রিপগুলো দেখুন',
  f2Li2: 'যারা তাদের সাথে ঘুরেছেন, তাদের রিভিউ পড়ুন',
  f2Li3: 'প্রোফাইল থেকেই সরাসরি এজেন্টকে মেসেজ করুন',
  altHouseboat: 'নীল আকাশের নিচে টাঙ্গুয়ার হাওরের খোলা পানিতে একটি কাঠের হাউসবোট',
  f2Since: '২০১৯ সাল থেকে টাঙ্গুয়ার হাওরে হাউসবোট ট্রিপ',
  f2Stat1: '৯.৬ হাজার',
  f2Stat1Label: 'ফলোয়ার',
  f2Stat2: '১৪২',
  f2Stat2Label: 'শেয়ার করা ট্রিপ',
  f2Stat3: '৪.৮',
  f2Stat3Label: '৩৮০টি রিভিউ থেকে',
  f2Review: '“ছবির চেয়েও পরিষ্কার, সবার জন্য লাইফ জ্যাকেট ছিল, আর রাঁধুনি প্রতিবেলা তাজা মাছ রান্না করেছেন।” <cite>নুসরাত, মার্চে ঘুরেছেন</cite>',

  f3Title: 'প্রতিটি জায়গার গাইড',
  f3Text: 'প্রতিটি গন্তব্যের নিজস্ব পেজ আছে, যা তৈরি হয় ভ্রমণকারীদের পোস্ট থেকে: কোন মাসে যাওয়া ভালো, ঢাকা থেকে কীভাবে যাবেন, কী সাথে নেবেন, আর সর্বশেষ ছবি। শুকনো মৌসুমের নাফাখুম আর বর্ষার নাফাখুম একদম আলাদা ট্রিপ, পেজে দুটোই দেখা যায়।',
  f3Li1: 'সেরা সময় ও বর্তমান অবস্থা',
  f3Li2: 'ঢাকা থেকে রুট ও যাত্রার সময়',
  f3Li3: 'যেসব এজেন্ট সেখানে ট্রিপ পরিচালনা করেন',
  altNafakhum: 'বান্দরবানে চওড়া পাথরের ধাপ বেয়ে নেমে আসছে নাফাখুম জলপ্রপাত',
  f3GuideName: 'নাফাখুম জলপ্রপাত, বান্দরবান',
  f3BestLabel: 'সেরা সময়',
  f3Best: 'অক্টোবর থেকে ফেব্রুয়ারি',
  f3RouteLabel: 'ঢাকা থেকে',
  f3Route: 'বাসে বান্দরবান, তারপর থানচি হয়ে সাঙ্গু নদী দিয়ে নৌকায়',
  f3PostsLabel: 'সাম্প্রতিক পোস্ট',
  f3Posts: 'এই মাসে ৩১২টি',

  f4Title: 'বন্ধুদের সাথে ট্রিপের পরিকল্পনা করুন',
  f4Text: 'জায়গা আর পোস্ট সেভ করে একটি ট্রিপ প্ল্যানে রাখুন, দিন অনুযায়ী সাজান, আর যাদের সাথে যাচ্ছেন তাদের সাথে শেয়ার করুন। সবাই আইডিয়া যোগ করতে পারেন, তাই পুরো পরিকল্পনা গ্রুপ চ্যাটে খুঁজে বেড়াতে হয় না।',
  f4Li1: 'সেভ করা জায়গাগুলো এক প্ল্যানে জড়ো করুন',
  f4Li2: 'দিন অনুযায়ী সাজান',
  f4Li3: 'একসাথে শেয়ার ও এডিট করুন',
  altSreemangal: 'শ্রীমঙ্গলের চা বাগানে ছায়াগাছের নিচে সবুজ চা গাছের সারি',
  f4PlanName: 'কাজিনদের সাথে সিলেট',
  f4Day1: '<span>দিন ১</span>শ্রীমঙ্গলের চা বাগান, নীলকণ্ঠে সাত রঙের চা',
  f4Day2: '<span>দিন ২</span>লাউয়াছড়া বনে হাঁটা, তারপর নৌকায় রাতারগুল',
  f4Day3: '<span>দিন ৩</span>জাফলং আর পিয়াইন নদী',

  placesTitle: 'সবচেয়ে বেশি শেয়ার হওয়া জায়গা',
  placesText: 'পৃথিবীর দীর্ঘতম সমুদ্রসৈকত থেকে সবচেয়ে বড় ম্যানগ্রোভ বন, বাংলাদেশে এক উইকেন্ডেই অনেক কিছু দেখা যায়।',
  altCox: 'সূর্যাস্তের সময় কক্সবাজার সৈকতের ভেজা বালুতে হাঁটছেন মানুষ',
  altSundarbans: 'সুন্দরবনে ঘন ম্যানগ্রোভ গাছে ঘেরা একটি শান্ত খাল',
  altSaintMartin: 'সেন্টমার্টিন দ্বীপের তীরে গোলাপি ফুল আর নারকেল গাছ',
  altHaorBoat: 'আধা-ডোবা একটি গাছের পাশ দিয়ে ছোট নৌকায় টাঙ্গুয়ার হাওর পার হচ্ছেন মানুষ',

  travelersTitle: 'ভ্রমণকারীদের জন্য',
  travelersText: 'ভ্রমণকারীদের জন্য Plezar সম্পূর্ণ ফ্রি। পরের গন্তব্য খুঁজতে, আর ঢাকা ছাড়ার আগেই ট্রিপটা আসলে কেমন তা দেখতে এটি ব্যবহার করুন।',
  tp1: '<strong>আসল ট্রিপ থেকে আইডিয়া নিন</strong><span>গত উইকেন্ডে মানুষ আসলে কোথায় গেছে দেখুন, পাঁচ বছরের পুরোনো ব্লগ পোস্ট নয়।</span>',
  tp2: '<strong>কী অপেক্ষা করছে জেনে নিন</strong><span>ছবি আর নোটে রওনা হওয়ার আগেই রাস্তা, থাকার ঘর আর আবহাওয়া দেখা যায়।</span>',
  tp3: '<strong>নিশ্চিন্তে এজেন্ট বেছে নিন</strong><span>তাদের আগের ট্রিপ আর রিভিউ পাশাপাশি মিলিয়ে দেখুন।</span>',
  tp4: '<strong>নিজের ভ্রমণের গল্প রেখে দিন</strong><span>আপনার পোস্টগুলো হয়ে ওঠে বাংলাদেশে আপনার ঘুরে আসা সব জায়গার মানচিত্র।</span>',

  agentsTitle: 'ট্যুর এজেন্টদের জন্য',
  agentsLead: 'Plezar সবার জন্য খোলার আগে আমরা প্রথম দফায় কিছু ট্যুর এজেন্টকে প্রোফাইল তৈরির আমন্ত্রণ জানাচ্ছি। আপনার এজেন্সি সম্পর্কে জানান, আমাদের টিম যোগাযোগ করবে।',
  ap1: '<strong>আপনার কাজ দেখান।</strong> প্রতিটি পোস্ট করা ট্রিপ আপনার পোর্টফোলিওতে যোগ হয়, যা মানুষ যেকোনো সময় দেখতে পারে।',
  ap2: '<strong>আগ্রহী ফলোয়ার বাড়ান।</strong> যারা আপনাকে ফলো করেন, তারা আপনার নতুন ট্রিপ সবার আগে দেখেন।',
  ap3: '<strong>রিভিউ দিয়ে আস্থা অর্জন করুন।</strong> আসল ভ্রমণকারীদের সৎ রিভিউ আপনার প্রোফাইলে থেকে যায়।',
  ap4: '<strong>ভেরিফায়েড হন।</strong> একবার ট্রেড লাইসেন্স দেখান, অচেনা পেজগুলোর ভিড়ে আলাদা হয়ে উঠুন।',

  formTitle: 'আপনার এজেন্সি সম্পর্কে জানান',
  formHint: '* চিহ্নিত ঘরগুলো পূরণ করা আবশ্যক। এই তথ্য শুধু Plezar নিয়ে আপনার সাথে যোগাযোগের জন্য ব্যবহার করা হবে।',
  lblAgency: 'এজেন্সির নাম *',
  lblName: 'আপনার নাম *',
  lblPhone: 'মোবাইল নম্বর *',
  lblEmail: 'ইমেইল *',
  lblRegions: 'কোথায় কোথায় ট্যুর পরিচালনা করেন?',
  phRegions: 'সাজেক, বান্দরবান, কক্সবাজার',
  lblWebsite: 'ফেসবুক পেজ বা ওয়েবসাইট',
  lblMessage: 'আর কিছু জানাতে চান?',
  phMessage: 'কত বছর ধরে ট্যুর করছেন, গ্রুপের আকার, আমাদের জন্য প্রশ্ন',
  formSubmit: 'আমার তথ্য পাঠান',
  doneTitle: 'ধন্যবাদ, আপনার তথ্য পেয়েছি',
  doneText: 'আমাদের টিম ২ কর্মদিবসের মধ্যে আপনার সাথে যোগাযোগ করবে।',
  doneAgain: 'আরেকটি এজেন্সির তথ্য পাঠান',

  updatesTitle: 'Plezar-এর পথচলার সাথে থাকুন',
  updatesText: 'নতুন কিছু দেখার থাকলে মাঝে মাঝে ইমেইল পাবেন: নতুন ফিচার, আগেভাগে ব্যবহারের সুযোগ, আর আমাদের কমিউনিটি যেসব জায়গা শেয়ার করছে।',
  lblUpdatesEmail: 'ইমেইল ঠিকানা',
  updatesSubmit: 'আমাকে আপডেট পাঠান',
  updatesNote: 'কোনো স্প্যাম নয়। এক ক্লিকেই আনসাবস্ক্রাইব করুন।',

  footerTagline: 'বাংলাদেশে ভ্রমণের একটি সামাজিক অ্যাপ।',
  footerPlace: 'Plezar, ঢাকা',
  creditsTitle: 'ছবি',
  creditsText: 'সব ছবি উইকিমিডিয়া কমন্স থেকে নেওয়া, তাদের লাইসেন্স অনুযায়ী ব্যবহৃত।'
};

// Strings shown from JavaScript (form errors, toasts, button states)
const MESSAGES = {
  en: {
    subscribed: "You're subscribed. We'll email you when there's news.",
    subscribeFailed: 'Could not subscribe. Check the email address and try again.',
    offline: 'Could not reach the server. Check your connection and try again.',
    errAgency: 'Enter your agency name.',
    errName: 'Enter your name.',
    errPhone: 'Enter a Bangladeshi mobile number, for example 01712345678.',
    errEmail: 'Enter a valid email address.',
    errAgentFailed: 'Could not send your details. Please try again.',
    sending: 'Sending...',
    formSubmit: 'Send my details',
    doneText: 'Our team will contact you within 2 working days.'
  },
  bn: {
    subscribed: 'সাবস্ক্রাইব হয়েছে। নতুন কিছু হলে আমরা ইমেইল করব।',
    subscribeFailed: 'সাবস্ক্রাইব করা যায়নি। ইমেইল ঠিকানাটি দেখে আবার চেষ্টা করুন।',
    offline: 'সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
    errAgency: 'এজেন্সির নাম লিখুন।',
    errName: 'আপনার নাম লিখুন।',
    errPhone: 'বাংলাদেশি মোবাইল নম্বর লিখুন, যেমন 01712345678।',
    errEmail: 'সঠিক ইমেইল ঠিকানা লিখুন।',
    errAgentFailed: 'আপনার তথ্য পাঠানো যায়নি। আবার চেষ্টা করুন।',
    sending: 'পাঠানো হচ্ছে...',
    formSubmit: 'আমার তথ্য পাঠান',
    doneText: 'আমাদের টিম ২ কর্মদিবসের মধ্যে আপনার সাথে যোগাযোগ করবে।'
  }
};

const i18n = {
  lang: 'en',
  original: new Map() // element -> { text?, html?, attrs: {} } captured English
};

function readSavedLang() {
  try {
    return localStorage.getItem(LANG_KEY) === 'bn' ? 'bn' : 'en';
  } catch (e) {
    return 'en';
  }
}

function saveLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch (e) {
    // Storage blocked (private mode); the choice just won't persist
  }
}

// Translate a JavaScript message for the current language
function t(key) {
  return (MESSAGES[i18n.lang] && MESSAGES[i18n.lang][key]) || MESSAGES.en[key] || key;
}

function captureOriginal(el) {
  if (i18n.original.has(el)) return i18n.original.get(el);
  const entry = { attrs: {} };
  if (el.hasAttribute('data-i18n')) entry.text = el.textContent;
  if (el.hasAttribute('data-i18n-html')) entry.html = el.innerHTML;
  (el.getAttribute('data-i18n-attr') || '').split(',').forEach(pair => {
    const [attr] = pair.split(':').map(s => s.trim());
    if (attr) entry.attrs[attr] = el.getAttribute(attr);
  });
  i18n.original.set(el, entry);
  return entry;
}

function applyLang(lang) {
  i18n.lang = lang === 'bn' ? 'bn' : 'en';
  const bn = i18n.lang === 'bn';

  document.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]').forEach(el => {
    const orig = captureOriginal(el);

    const textKey = el.getAttribute('data-i18n');
    if (textKey) el.textContent = bn && BN[textKey] ? BN[textKey] : orig.text;

    const htmlKey = el.getAttribute('data-i18n-html');
    if (htmlKey) el.innerHTML = bn && BN[htmlKey] ? BN[htmlKey] : orig.html;

    (el.getAttribute('data-i18n-attr') || '').split(',').forEach(pair => {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (!attr || !key) return;
      const value = bn && BN[key] ? BN[key] : orig.attrs[attr];
      if (value != null) el.setAttribute(attr, value);
    });
  });

  // Page title and description
  if (!i18n.original.has(document)) {
    const meta = document.querySelector('meta[name="description"]');
    i18n.original.set(document, { title: document.title, description: meta ? meta.content : '' });
  }
  const docOrig = i18n.original.get(document);
  document.title = bn ? BN.metaTitle : docOrig.title;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = bn ? BN.metaDescription : docOrig.description;

  document.documentElement.lang = i18n.lang;

  // The toggle always offers the other language
  const toggle = document.getElementById('langToggle');
  if (toggle) {
    toggle.textContent = bn ? 'English' : 'বাংলা';
    toggle.lang = bn ? 'en' : 'bn';
    toggle.setAttribute('aria-label', bn ? 'View in English' : 'বাংলায় দেখুন');
  }
}

function toggleLang() {
  const next = i18n.lang === 'bn' ? 'en' : 'bn';
  applyLang(next);
  saveLang(next);
}

// Apply a saved Bangla preference straight away; English needs no work
if (readSavedLang() === 'bn') applyLang('bn');
