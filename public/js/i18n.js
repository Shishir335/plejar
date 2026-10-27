/**
 * Plejar showcase page - English / Bangla language switcher
 *
 * English lives in the HTML and is the default. Elements opt in with:
 *   data-i18n="key"            replace text
 *   data-i18n-html="key"       replace inner HTML (for strings with <strong>, <span> etc.)
 *   data-i18n-attr="alt:key"   replace attributes (comma-separated attr:key pairs)
 * Bangla strings live in BN below. Strings used from JavaScript live in MESSAGES.
 */

const LANG_KEY = 'plezar_lang';

const BN = {
  metaTitle: 'Plejar — বাংলাদেশ, যারা ঘুরে বেড়ান তাদের চোখে',
  metaDescription: 'Plejar বাংলাদেশে ভ্রমণের একটি সামাজিক অ্যাপ। ভ্রমণকারীরা তাদের ট্রিপ শেয়ার করেন, স্থানীয় ট্যুর এজেন্টরা তাদের কাজ তুলে ধরেন, আর সবাই আসল ছবি ও সৎ রিভিউ দেখে পরিকল্পনা করেন।',

  skip: 'মূল অংশে যান',
  logoLabel: 'Plejar হোম',
  menuLabel: 'মেনু',
  navApp: 'অ্যাপ',
  navFeatures: 'ফিচার',
  navPlaces: 'জায়গা',
  navTravelers: 'ভ্রমণকারীদের জন্য',
  navAgents: 'এজেন্টদের জন্য',
  navCta: 'আপডেট পান',
  navSignIn: 'লগইন',

  heroTitle: 'বাংলাদেশ, যারা ঘুরে বেড়ান তাদের চোখে।',
  heroText: 'Plejar বাংলাদেশে ভ্রমণের একটি সামাজিক অ্যাপ। ভ্রমণকারীরা তাদের ট্রিপ শেয়ার করেন, স্থানীয় ট্যুর এজেন্টরা তাদের কাজ তুলে ধরেন, আর সবাই আসল ছবি ও সৎ রিভিউ দেখে পরের ট্রিপের পরিকল্পনা করেন।',
  heroCta1: 'অ্যাপটি কী করে দেখুন',
  heroCta2: 'প্রজেক্টের খবর রাখুন',
  heroPlace: 'পাহাড়ের কোলে চা বাগান',
  altJaflong: 'জাফলং, সিলেটের পাহাড়ি চা বাগানে কাজ করছেন চা শ্রমিকরা, পেছনে কুয়াশাঢাকা পাহাড়',

  whatTitle: 'বাংলাদেশে ঘোরার মতো সব জায়গা, এক জায়গায়',
  whatLead: 'এখন ট্রিপের আইডিয়া ছড়িয়ে আছে ফেসবুক গ্রুপ, ইউটিউব ভ্লগ আর বন্ধুদের ছবির অ্যালবামে। ট্যুর এজেন্টরা শত শত গ্রুপে পোস্ট দেন আর আশা করেন কেউ দেখবে। Plejar দুটোকেই এক ফিডে নিয়ে আসে।',
  factTravelersTitle: 'ভ্রমণকারীদের জন্য',
  factTravelersText: 'আসল ট্রিপের মাধ্যমে নতুন জায়গা খুঁজুন, পছন্দের এজেন্টদের ফলো করুন, আর পরের গন্তব্যের পরিকল্পনা গুছিয়ে রাখুন।',
  factAgentsTitle: 'ট্যুর এজেন্টদের জন্য',
  factAgentsText: 'আগের ট্রিপ, ছবি আর রিভিউ দিয়ে নিজের প্রোফাইল তৈরি করুন, যাতে কল করার আগেই মানুষ আপনাকে চিনতে পারে।',
  phoneLabel: 'Plejar অ্যাপের ফিড',
  appFollowing: 'ফলো করছেন',
  appNearby: 'কাছাকাছি',
  placeSajek: 'সাজেক ভ্যালি',
  altSajek: 'সাজেকে মেঘে ঢাকা উপত্যকার ওপর সূর্যোদয়',
  appPost: '<b>১,২০৪ লাইক</b> আজ ভোর ৫:৪০-এ উপত্যকায় মেঘ নেমে এসেছিল। আমাদের ১৮ জনের দল কংলাক পাড়া থেকে দেখেছে।',

  featuresTitle: 'Plejar-এ আপনি যা করতে পারবেন',
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
  travelersText: 'ভ্রমণকারীদের জন্য Plejar সম্পূর্ণ ফ্রি। পরের গন্তব্য খুঁজতে, আর ঢাকা ছাড়ার আগেই ট্রিপটা আসলে কেমন তা দেখতে এটি ব্যবহার করুন।',
  tp1: '<strong>আসল ট্রিপ থেকে আইডিয়া নিন</strong><span>গত উইকেন্ডে মানুষ আসলে কোথায় গেছে দেখুন, পাঁচ বছরের পুরোনো ব্লগ পোস্ট নয়।</span>',
  tp2: '<strong>কী অপেক্ষা করছে জেনে নিন</strong><span>ছবি আর নোটে রওনা হওয়ার আগেই রাস্তা, থাকার ঘর আর আবহাওয়া দেখা যায়।</span>',
  tp3: '<strong>নিশ্চিন্তে এজেন্ট বেছে নিন</strong><span>তাদের আগের ট্রিপ আর রিভিউ পাশাপাশি মিলিয়ে দেখুন।</span>',
  tp4: '<strong>নিজের ভ্রমণের গল্প রেখে দিন</strong><span>আপনার পোস্টগুলো হয়ে ওঠে বাংলাদেশে আপনার ঘুরে আসা সব জায়গার মানচিত্র।</span>',

  agentsTitle: 'ট্যুর এজেন্টদের জন্য',
  agentsLead: 'Plejar-এ ট্যুর এজেন্সিগুলো সদস্য হিসেবে যোগ দেয়। আবেদন করুন, আমরা আপনার লাইসেন্স যাচাই করব, তারপর আপনার এজেন্সির প্রোফাইল চালু করবেন।',
  ap1: '<strong>আপনার কাজ দেখান।</strong> প্রতিটি পোস্ট করা ট্রিপ আপনার পোর্টফোলিওতে যোগ হয়, যা মানুষ যেকোনো সময় দেখতে পারে।',
  ap2: '<strong>আগ্রহী ফলোয়ার বাড়ান।</strong> যারা আপনাকে ফলো করেন, তারা আপনার নতুন ট্রিপ সবার আগে দেখেন।',
  ap3: '<strong>রিভিউ দিয়ে আস্থা অর্জন করুন।</strong> আসল ভ্রমণকারীদের সৎ রিভিউ আপনার প্রোফাইলে থেকে যায়।',
  ap4: '<strong>ভেরিফায়েড হন।</strong> একবার ট্রেড লাইসেন্স দেখান, অচেনা পেজগুলোর ভিড়ে আলাদা হয়ে উঠুন।',

  joinTitle: 'Plejar-এর সদস্য এজেন্সি হোন',
  joinText: 'অনলাইনে আবেদন করুন। আমাদের টিম প্রতিটি আবেদন নিজে যাচাই করে, তাই Plejar-এ শুধু আসল ও লাইসেন্সধারী এজেন্সিরাই থাকে।',
  join1: '<strong>অনলাইনে আবেদন করুন</strong><span>এজেন্সির তথ্য, ট্রেড লাইসেন্স আর মালিকের এনআইডি দিন। মোটামুটি ১০ মিনিট লাগে।</span>',
  join2: '<strong>আমরা ৩ কর্মদিবসের মধ্যে যাচাই করি</strong><span>কিছু বাকি থাকলে আপনার আবেদনের পেজেই জানাব।</span>',
  join3: '<strong>ভেন্ডর প্যানেল চালু করুন</strong><span>গৃহীত হলে সাইন ইনের তথ্য ইমেইলে পাবেন।</span>',
  joinApply: 'সদস্যপদের জন্য আবেদন করুন',
  joinStatus: 'আবেদনের অবস্থা দেখুন',

  applyMetaTitle: 'সদস্যপদের জন্য আবেদন — Plejar',
  applyMetaDescription: 'বাংলাদেশের ট্যুর এজেন্সিগুলো Plejar-এ যোগ দিতে আবেদন করতে পারে। এজেন্সির তথ্য, ট্রেড লাইসেন্স আর মালিকের এনআইডি পাঠান, আমাদের টিম ৩ কর্মদিবসের মধ্যে যাচাই করবে।',
  applyNavBack: 'এজেন্টদের জন্য',
  applyNavStatus: 'আবেদনের অবস্থা দেখুন',
  applyNavApply: 'সদস্যপদের জন্য আবেদন করুন',
  applyTitle: 'সদস্য এজেন্সি হিসেবে Plejar-এ যোগ দিন',
  applyLead: 'আপনার এজেন্সি সম্পর্কে জানান, আর ট্রেড লাইসেন্স ও মালিকের জাতীয় পরিচয়পত্র পাঠান। আমাদের টিম প্রতিটি আবেদন নিজে যাচাই করে এবং ৩ কর্মদিবসের মধ্যে উত্তর দেয়।',
  partAgency: 'আপনার এজেন্সি',
  partYou: 'আপনি',
  partYouNote: 'আবেদন গৃহীত হলে এজেন্সি প্যানেলে মালিক হিসেবে সাইন ইন করবেন এই ব্যক্তি।',
  partDocs: 'কাগজপত্র',
  partDocsNote: 'ছবি বা পিডিএফ, প্রতিটি সর্বোচ্চ ৫ এমবি। শুধু আমাদের যাচাই টিম এগুলো দেখতে পারে।',
  partSend: 'দেখে নিয়ে পাঠান',
  lblAgency: 'এজেন্সির নাম *',
  lblLicenseNo: 'ট্রেড লাইসেন্স নম্বর *',
  lblYear: 'কোন সাল থেকে চালু',
  lblDistrict: 'অফিসের জেলা',
  lblTeam: 'টিমের আকার',
  optChoose: 'বেছে নিন',
  optTeam1: 'শুধু আমি',
  optTeam2: '২ থেকে ৫ জন',
  optTeam3: '৬ থেকে ১৫ জন',
  optTeam4: '১৬ জন বা তার বেশি',
  lblAddress: 'অফিসের ঠিকানা',
  lblRegions: 'কোথায় কোথায় ট্যুর পরিচালনা করেন?',
  phRegions: 'সাজেক, বান্দরবান, কক্সবাজার',
  lblTourTypes: 'কী ধরনের ট্যুর করেন',
  lblWebsite: 'ফেসবুক পেজ বা ওয়েবসাইট',
  lblAbout: 'কয়েক লাইনে আপনার এজেন্সির পরিচয় দিন',
  phAbout: 'যে ট্রিপগুলোর জন্য আপনারা পরিচিত, গ্রুপের আকার, ভ্রমণকারীরা আপনাদের কী পছন্দ করেন',
  lblName: 'আপনার নাম *',
  lblRole: 'আপনার পদ',
  phRole: 'মালিক',
  lblPhone: 'মোবাইল নম্বর *',
  lblEmail: 'ইমেইল *',
  docLicense: 'ট্রেড লাইসেন্স *',
  docLicenseHint: 'চলতি লাইসেন্স, নম্বর আর মেয়াদ যেন পড়া যায়।',
  docNid: 'মালিকের জাতীয় পরিচয়পত্র *',
  docNidHint: 'সামনে ও পেছনে। দুটি ফাইল দিতে পারেন।',
  docTourism: 'ট্যুরিজম লাইসেন্স বা TOAB সদস্যপদ',
  docTourismHint: 'থাকলে দিন। এতে যাচাই দ্রুত হয়।',
  docOther: 'অন্য কিছু',
  docOtherHint: 'যেমন ব্রোশিওর বা আগের ট্রিপের ছবি।',
  docAdd: 'ফাইল যোগ করুন',
  lblMessage: 'আর কিছু জানাতে চান?',
  phMessageApply: 'আমাদের জন্য প্রশ্ন, বা কখন ফোন করলে সুবিধা',
  agreeText: 'আমি নিশ্চিত করছি যে এই তথ্য সত্য, আমি এই এজেন্সির পক্ষে কাজ করতে পারি, এবং Plejar সংশ্লিষ্ট অফিস থেকে এগুলো যাচাই করতে পারে।',
  applySubmit: 'আবেদন পাঠান',
  cardAria: 'আপনার সদস্য কার্ডের নমুনা',
  cardKind: 'সদস্য এজেন্সি',
  cardEmptyName: 'আপনার এজেন্সি',
  cardSince: 'চালু',
  cardRef: 'রেফারেন্স',
  stampDraft: 'খসড়া',
  next1: '<strong>আপনি আবেদন পাঠান।</strong> আমরা একটি রেফারেন্স নম্বর ইমেইল করি।',
  next2: '<strong>আমরা ৩ কর্মদিবসের মধ্যে যাচাই করি।</strong> কিছু বাকি থাকলে আপনার আবেদনের পেজে জানাই।',
  next3: '<strong>আপনি ভেন্ডর প্যানেল চালু করেন।</strong> গৃহীত হলে আমরা সাইন ইনের তথ্য ইমেইল করি।',
  doneApplyTitle: 'আপনার আবেদন জমা হয়েছে',
  doneCheck: 'আবেদনের অবস্থা দেখুন',
  doneHome: 'Plejar-এ ফিরে যান',
  statusMetaTitle: 'আবেদনের অবস্থা — Plejar',
  statusTitle: 'আপনার আবেদনের অবস্থা দেখুন',
  statusLead: 'আমাদের ইমেইলে পাওয়া রেফারেন্স নম্বর আর যে ইমেইল দিয়ে আবেদন করেছেন সেটি লিখুন।',
  lblRef: 'রেফারেন্স নম্বর',
  lblEmailPlain: 'ইমেইল',
  statusSubmit: 'আমার আবেদন দেখান',
  statusNoRef: 'এখনো আবেদন করেননি?',
  statusApplyLink: 'সদস্যপদের জন্য আবেদন করুন',

  updatesTitle: 'Plejar-এর পথচলার সাথে থাকুন',
  updatesText: 'নতুন কিছু দেখার থাকলে মাঝে মাঝে ইমেইল পাবেন: নতুন ফিচার, আগেভাগে ব্যবহারের সুযোগ, আর আমাদের কমিউনিটি যেসব জায়গা শেয়ার করছে।',
  lblUpdatesEmail: 'ইমেইল ঠিকানা',
  updatesSubmit: 'আমাকে আপডেট পাঠান',
  updatesNote: 'কোনো স্প্যাম নয়। এক ক্লিকেই আনসাবস্ক্রাইব করুন।',

  footerTagline: 'বাংলাদেশে ভ্রমণের একটি সামাজিক অ্যাপ।',
  footerPlace: 'Plejar, ঢাকা',
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
    sending: 'Sending...',
    errLicenseNo: 'Enter your trade license number.',
    errYear: 'Enter the year your agency started, for example 2018.',
    errLicenseFile: 'Add a photo or PDF of your trade license.',
    errNidFile: "Add the owner's national ID card.",
    errAgree: 'Tick the box to confirm the details are true.',
    errFileType: 'Use a JPG, PNG, WebP or PDF file.',
    errFileSize: 'This file is over 5 MB. Use a smaller photo or PDF.',
    errDuplicate: 'We already have an application for this agency. Check it with the reference number we emailed you.',
    errTooMany: 'Too many attempts from your connection. Please try again later.',
    errApplyFailed: 'Could not send your application. Please try again.',
    sendingApplication: 'Sending application...',
    applySubmit: 'Send application',
    removeFile: 'Remove',
    stampSent: 'Received',
    doneEmailed: 'We emailed a copy to {email}. Our team will review it within 3 working days, and you can check its progress any time with your reference number.',
    doneNoEmail: 'Write down your reference number: you need it, with your email address, to check your application. Our team will review it within 3 working days.',
    errRef: 'Enter the reference number from our email, for example PLZ-7KQ2M9.',
    errNotFound: 'No application matches that reference number and email. Check both and try again.',
    looking: 'Looking...',
    statusSubmit: 'Show my application',
    stepReceived: 'Application received',
    stepReview: 'Our team is reviewing it',
    stepReviewSoon: 'Usually within 3 working days',
    stepInfo: 'We asked for more information',
    stepInfoNow: 'Waiting for your reply below',
    stepDecision: 'Decision',
    stepDecisionNote: 'We email you either way',
    stepApproved: 'Accepted',
    stepRejected: 'Not accepted',
    bannerReview: 'Your application is being reviewed',
    bannerReviewText: 'Nothing for you to do right now. We will email you when there is news.',
    bannerInfo: 'We need something from you',
    bannerInfoText: 'Read our message below and reply here. You can add documents too.',
    bannerApproved: 'Welcome to Plejar',
    bannerApprovedText: 'Your agency was accepted. We will email you the sign-in details for your vendor panel, where you can create tour events and post announcements.',
    bannerRejected: 'Your application was not accepted',
    bannerRejectedText: 'You are welcome to apply again once this is sorted out.',
    bannerClosed: 'This application is closed',
    bannerClosedText: 'If you still want to join, send a new application.',
    threadTitle: 'Messages',
    fromTeam: 'Plejar team',
    fromYou: 'You',
    replyLabel: 'Your reply',
    replyKind: 'What kind of document',
    replyAddFile: 'Add a document',
    replySubmit: 'Send reply',
    replySent: 'Reply sent. Our team will look at it soon.',
    errReplyEmpty: 'Write a reply or add a document.',
    errReplyKindLimit: 'Add at most one trade license, one tourism license, two NID files and two other files.',
    errReplyFailed: 'Could not send your reply. Please try again.',
    errTooManyFiles: 'You can add up to 4 documents in one reply.',
    docsTitle: 'Documents you sent',
    noDocs: 'None',
    cardRefLower: 'Reference',
    kindLicense: 'Trade license',
    kindNid: 'National ID',
    kindTourism: 'Tourism license',
    kindOther: 'Other document'
  },
  bn: {
    subscribed: 'সাবস্ক্রাইব হয়েছে। নতুন কিছু হলে আমরা ইমেইল করব।',
    subscribeFailed: 'সাবস্ক্রাইব করা যায়নি। ইমেইল ঠিকানাটি দেখে আবার চেষ্টা করুন।',
    offline: 'সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
    errAgency: 'এজেন্সির নাম লিখুন।',
    errName: 'আপনার নাম লিখুন।',
    errPhone: 'বাংলাদেশি মোবাইল নম্বর লিখুন, যেমন 01712345678।',
    errEmail: 'সঠিক ইমেইল ঠিকানা লিখুন।',
    sending: 'পাঠানো হচ্ছে...',
    errLicenseNo: 'ট্রেড লাইসেন্স নম্বর লিখুন।',
    errYear: 'এজেন্সি কোন সালে চালু হয়েছে লিখুন, যেমন 2018।',
    errLicenseFile: 'ট্রেড লাইসেন্সের ছবি বা পিডিএফ যোগ করুন।',
    errNidFile: 'মালিকের জাতীয় পরিচয়পত্র যোগ করুন।',
    errAgree: 'তথ্য সত্য তা নিশ্চিত করতে বক্সে টিক দিন।',
    errFileType: 'JPG, PNG, WebP বা PDF ফাইল দিন।',
    errFileSize: 'ফাইলটি ৫ এমবির বেশি। ছোট ছবি বা পিডিএফ দিন।',
    errDuplicate: 'এই এজেন্সির একটি আবেদন আমাদের কাছে আছে। ইমেইলে পাঠানো রেফারেন্স নম্বর দিয়ে সেটির অবস্থা দেখুন।',
    errTooMany: 'আপনার সংযোগ থেকে অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
    errApplyFailed: 'আবেদন পাঠানো যায়নি। আবার চেষ্টা করুন।',
    sendingApplication: 'আবেদন পাঠানো হচ্ছে...',
    applySubmit: 'আবেদন পাঠান',
    removeFile: 'সরান',
    stampSent: 'গৃহীত',
    doneEmailed: '{email} ঠিকানায় একটি কপি ইমেইল করেছি। আমাদের টিম ৩ কর্মদিবসের মধ্যে যাচাই করবে, আর রেফারেন্স নম্বর দিয়ে যেকোনো সময় অবস্থা দেখতে পারবেন।',
    doneNoEmail: 'রেফারেন্স নম্বরটি লিখে রাখুন: আবেদনের অবস্থা দেখতে এটি আর আপনার ইমেইল লাগবে। আমাদের টিম ৩ কর্মদিবসের মধ্যে যাচাই করবে।',
    errRef: 'ইমেইলে পাওয়া রেফারেন্স নম্বর লিখুন, যেমন PLZ-7KQ2M9।',
    errNotFound: 'এই রেফারেন্স নম্বর আর ইমেইলের সাথে কোনো আবেদন মেলেনি। দুটোই দেখে আবার চেষ্টা করুন।',
    looking: 'খোঁজা হচ্ছে...',
    statusSubmit: 'আমার আবেদন দেখান',
    stepReceived: 'আবেদন পেয়েছি',
    stepReview: 'আমাদের টিম যাচাই করছে',
    stepReviewSoon: 'সাধারণত ৩ কর্মদিবসের মধ্যে',
    stepInfo: 'আমরা আরও তথ্য চেয়েছি',
    stepInfoNow: 'নিচে আপনার উত্তরের অপেক্ষায়',
    stepDecision: 'সিদ্ধান্ত',
    stepDecisionNote: 'যা-ই হোক, আমরা ইমেইল করব',
    stepApproved: 'গৃহীত',
    stepRejected: 'গৃহীত হয়নি',
    bannerReview: 'আপনার আবেদন যাচাই করা হচ্ছে',
    bannerReviewText: 'এখন আপনার কিছু করার নেই। খবর হলে আমরা ইমেইল করব।',
    bannerInfo: 'আপনার কাছ থেকে কিছু দরকার',
    bannerInfoText: 'নিচে আমাদের বার্তা পড়ে এখানেই উত্তর দিন। কাগজপত্রও যোগ করতে পারেন।',
    bannerApproved: 'Plejar-এ স্বাগতম',
    bannerApprovedText: 'আপনার এজেন্সি গৃহীত হয়েছে। ভেন্ডর প্যানেলে সাইন ইন করার তথ্য আমরা আপনাকে ইমেইল করব, সেখানে ট্যুর ইভেন্ট তৈরি আর ঘোষণা দিতে পারবেন।',
    bannerRejected: 'আপনার আবেদন গৃহীত হয়নি',
    bannerRejectedText: 'বিষয়টি ঠিক হলে আবার আবেদন করতে পারেন।',
    bannerClosed: 'এই আবেদনটি বন্ধ করা হয়েছে',
    bannerClosedText: 'এখনো যোগ দিতে চাইলে নতুন আবেদন পাঠান।',
    threadTitle: 'বার্তা',
    fromTeam: 'Plejar টিম',
    fromYou: 'আপনি',
    replyLabel: 'আপনার উত্তর',
    replyKind: 'কাগজের ধরন',
    replyAddFile: 'কাগজ যোগ করুন',
    replySubmit: 'উত্তর পাঠান',
    replySent: 'উত্তর পাঠানো হয়েছে। আমাদের টিম শিগগিরই দেখবে।',
    errReplyEmpty: 'উত্তর লিখুন বা একটি কাগজ যোগ করুন।',
    errReplyKindLimit: 'সর্বোচ্চ একটি ট্রেড লাইসেন্স, একটি ট্যুরিজম লাইসেন্স, দুটি এনআইডি ফাইল আর দুটি অন্য ফাইল দিন।',
    errReplyFailed: 'উত্তর পাঠানো যায়নি। আবার চেষ্টা করুন।',
    errTooManyFiles: 'এক উত্তরে সর্বোচ্চ ৪টি কাগজ যোগ করা যায়।',
    docsTitle: 'আপনার পাঠানো কাগজপত্র',
    noDocs: 'কিছু নেই',
    cardRefLower: 'রেফারেন্স',
    kindLicense: 'ট্রেড লাইসেন্স',
    kindNid: 'জাতীয় পরিচয়পত্র',
    kindTourism: 'ট্যুরিজম লাইসেন্স',
    kindOther: 'অন্য কাগজ'
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
  const titleKey = (document.body && document.body.dataset.titleKey) || 'metaTitle';
  const descriptionKey = (document.body && document.body.dataset.descriptionKey) || 'metaDescription';
  document.title = bn ? BN[titleKey] : docOrig.title;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = bn ? BN[descriptionKey] : docOrig.description;

  document.documentElement.lang = i18n.lang;

  // The toggle always offers the other language
  const toggle = document.getElementById('langToggle');
  if (toggle) {
    toggle.textContent = bn ? 'English' : 'বাংলা';
    toggle.lang = bn ? 'en' : 'bn';
    toggle.setAttribute('aria-label', bn ? 'View in English' : 'বাংলায় দেখুন');
  }

  // Pages redraw anything they built in JavaScript
  document.dispatchEvent(new CustomEvent('langchange'));
}

function toggleLang() {
  const next = i18n.lang === 'bn' ? 'en' : 'bn';
  applyLang(next);
  saveLang(next);
}

// Apply a saved Bangla preference straight away; English needs no work
if (readSavedLang() === 'bn') applyLang('bn');
