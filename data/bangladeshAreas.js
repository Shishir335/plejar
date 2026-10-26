/**
 * Areas inside each district for the app's address form ("Select Area"): the district's upazilas,
 * plus the main city areas for the big cities. Keyed by the district slug in data/bangladesh.js.
 */
const AREAS = {
  // Barishal
  barguna: ['Amtali', 'Bamna', 'Barguna Sadar', 'Betagi', 'Patharghata', 'Taltali'],
  barishal: ['Agailjhara', 'Babuganj', 'Bakerganj', 'Banaripara', 'Barishal Sadar', 'Gaurnadi', 'Hizla', 'Mehendiganj', 'Muladi', 'Wazirpur'],
  bhola: ['Bhola Sadar', 'Burhanuddin', 'Char Fasson', 'Daulatkhan', 'Lalmohan', 'Manpura', 'Tazumuddin'],
  jhalokathi: ['Jhalokathi Sadar', 'Kathalia', 'Nalchity', 'Rajapur'],
  patuakhali: ['Bauphal', 'Dashmina', 'Dumki', 'Galachipa', 'Kalapara', 'Mirzaganj', 'Patuakhali Sadar', 'Rangabali'],
  pirojpur: ['Bhandaria', 'Indurkani', 'Kawkhali', 'Mathbaria', 'Nazirpur', 'Nesarabad', 'Pirojpur Sadar'],
  // Chattogram
  bandarban: ['Ali Kadam', 'Bandarban Sadar', 'Lama', 'Naikhongchhari', 'Rowangchhari', 'Ruma', 'Thanchi'],
  brahmanbaria: ['Akhaura', 'Ashuganj', 'Bancharampur', 'Bijoynagar', 'Brahmanbaria Sadar', 'Kasba', 'Nabinagar', 'Nasirnagar', 'Sarail'],
  chandpur: ['Chandpur Sadar', 'Faridganj', 'Haimchar', 'Haziganj', 'Kachua', 'Matlab Dakshin', 'Matlab Uttar', 'Shahrasti'],
  chattogram: ['Agrabad', 'Bakalia', 'Bayazid', 'Chawkbazar', 'Double Mooring', 'GEC', 'Halishahar', 'Khulshi', 'Kotwali', 'Nasirabad', 'Pahartali', 'Panchlaish', 'Patenga',
    'Anwara', 'Banshkhali', 'Boalkhali', 'Chandanaish', 'Fatikchhari', 'Hathazari', 'Karnaphuli', 'Lohagara', 'Mirsharai', 'Patiya', 'Rangunia', 'Raozan', 'Sandwip', 'Satkania', 'Sitakunda'],
  cumilla: ['Barura', 'Brahmanpara', 'Burichang', 'Chandina', 'Chauddagram', 'Cumilla Adarsha Sadar', 'Cumilla Sadar Dakshin', 'Daudkandi', 'Debidwar', 'Homna', 'Laksam', 'Lalmai',
    'Meghna', 'Monohargonj', 'Muradnagar', 'Nangalkot', 'Titas'],
  'coxs-bazar': ['Chakaria', 'Cox’s Bazar Sadar', 'Eidgaon', 'Kutubdia', 'Maheshkhali', 'Pekua', 'Ramu', 'Teknaf', 'Ukhia'],
  feni: ['Chhagalnaiya', 'Daganbhuiyan', 'Feni Sadar', 'Fulgazi', 'Parshuram', 'Sonagazi'],
  khagrachhari: ['Dighinala', 'Guimara', 'Khagrachhari Sadar', 'Lakshmichhari', 'Mahalchhari', 'Manikchhari', 'Matiranga', 'Panchhari', 'Ramgarh'],
  lakshmipur: ['Kamalnagar', 'Lakshmipur Sadar', 'Raipur', 'Ramganj', 'Ramgati'],
  noakhali: ['Begumganj', 'Chatkhil', 'Companiganj', 'Hatiya', 'Kabirhat', 'Noakhali Sadar', 'Senbagh', 'Sonaimuri', 'Subarnachar'],
  rangamati: ['Baghaichhari', 'Barkal', 'Belaichhari', 'Juraichhari', 'Kaptai', 'Kawkhali', 'Langadu', 'Naniarchar', 'Rajasthali', 'Rangamati Sadar'],
  // Dhaka
  dhaka: ['Badda', 'Banani', 'Bashundhara', 'Cantonment', 'Dhanmondi', 'Gulshan', 'Jatrabari', 'Khilgaon', 'Lalbagh', 'Malibagh', 'Mirpur', 'Mohakhali', 'Mohammadpur',
    'Motijheel', 'Old Dhaka', 'Rampura', 'Shyamoli', 'Tejgaon', 'Uttara', 'Wari', 'Dhamrai', 'Dohar', 'Keraniganj', 'Nawabganj', 'Savar'],
  faridpur: ['Alfadanga', 'Bhanga', 'Boalmari', 'Char Bhadrasan', 'Faridpur Sadar', 'Madhukhali', 'Nagarkanda', 'Sadarpur', 'Saltha'],
  gazipur: ['Gazipur Sadar', 'Kaliakair', 'Kaliganj', 'Kapasia', 'Sreepur', 'Tongi'],
  gopalganj: ['Gopalganj Sadar', 'Kashiani', 'Kotalipara', 'Muksudpur', 'Tungipara'],
  kishoreganj: ['Austagram', 'Bajitpur', 'Bhairab', 'Hossainpur', 'Itna', 'Karimganj', 'Katiadi', 'Kishoreganj Sadar', 'Kuliarchar', 'Mithamain', 'Nikli', 'Pakundia', 'Tarail'],
  madaripur: ['Dasar', 'Kalkini', 'Madaripur Sadar', 'Rajoir', 'Shibchar'],
  manikganj: ['Daulatpur', 'Ghior', 'Harirampur', 'Manikganj Sadar', 'Saturia', 'Shibalaya', 'Singair'],
  munshiganj: ['Gazaria', 'Lohajang', 'Munshiganj Sadar', 'Sirajdikhan', 'Sreenagar', 'Tongibari'],
  narayanganj: ['Araihazar', 'Bandar', 'Narayanganj Sadar', 'Rupganj', 'Sonargaon'],
  narsingdi: ['Belabo', 'Monohardi', 'Narsingdi Sadar', 'Palash', 'Raipura', 'Shibpur'],
  rajbari: ['Baliakandi', 'Goalanda', 'Kalukhali', 'Pangsha', 'Rajbari Sadar'],
  shariatpur: ['Bhedarganj', 'Damudya', 'Gosairhat', 'Naria', 'Shariatpur Sadar', 'Zajira'],
  tangail: ['Basail', 'Bhuapur', 'Delduar', 'Dhanbari', 'Ghatail', 'Gopalpur', 'Kalihati', 'Madhupur', 'Mirzapur', 'Nagarpur', 'Sakhipur', 'Tangail Sadar'],
  // Khulna
  bagerhat: ['Bagerhat Sadar', 'Chitalmari', 'Fakirhat', 'Kachua', 'Mollahat', 'Mongla', 'Morrelganj', 'Rampal', 'Sarankhola'],
  chuadanga: ['Alamdanga', 'Chuadanga Sadar', 'Damurhuda', 'Jibannagar'],
  jashore: ['Abhaynagar', 'Bagherpara', 'Chaugachha', 'Jashore Sadar', 'Jhikargachha', 'Keshabpur', 'Manirampur', 'Sharsha'],
  jhenaidah: ['Harinakunda', 'Jhenaidah Sadar', 'Kaliganj', 'Kotchandpur', 'Maheshpur', 'Shailkupa'],
  khulna: ['Daulatpur', 'Khalishpur', 'Khan Jahan Ali', 'Khulna Sadar', 'Sonadanga', 'Batiaghata', 'Dacope', 'Dighalia', 'Dumuria', 'Koyra', 'Paikgachha', 'Phultala', 'Rupsha', 'Terokhada'],
  kushtia: ['Bheramara', 'Daulatpur', 'Khoksa', 'Kumarkhali', 'Kushtia Sadar', 'Mirpur'],
  magura: ['Magura Sadar', 'Mohammadpur', 'Shalikha', 'Sreepur'],
  meherpur: ['Gangni', 'Meherpur Sadar', 'Mujibnagar'],
  narail: ['Kalia', 'Lohagara', 'Narail Sadar'],
  satkhira: ['Assasuni', 'Debhata', 'Kalaroa', 'Kaliganj', 'Satkhira Sadar', 'Shyamnagar', 'Tala'],
  // Rajshahi
  bogura: ['Adamdighi', 'Bogura Sadar', 'Dhunat', 'Dhupchanchia', 'Gabtali', 'Kahaloo', 'Nandigram', 'Sariakandi', 'Shajahanpur', 'Sherpur', 'Shibganj', 'Sonatala'],
  'chapai-nawabganj': ['Bholahat', 'Chapai Nawabganj Sadar', 'Gomastapur', 'Nachole', 'Shibganj'],
  joypurhat: ['Akkelpur', 'Joypurhat Sadar', 'Kalai', 'Khetlal', 'Panchbibi'],
  naogaon: ['Atrai', 'Badalgachhi', 'Dhamoirhat', 'Manda', 'Mohadevpur', 'Naogaon Sadar', 'Niamatpur', 'Patnitala', 'Porsha', 'Raninagar', 'Sapahar'],
  natore: ['Bagatipara', 'Baraigram', 'Gurudaspur', 'Lalpur', 'Naldanga', 'Natore Sadar', 'Singra'],
  pabna: ['Atgharia', 'Bera', 'Bhangura', 'Chatmohar', 'Faridpur', 'Ishwardi', 'Pabna Sadar', 'Santhia', 'Sujanagar'],
  rajshahi: ['Boalia', 'Motihar', 'Rajpara', 'Shah Makhdum', 'Bagha', 'Bagmara', 'Charghat', 'Durgapur', 'Godagari', 'Mohanpur', 'Paba', 'Puthia', 'Tanore'],
  sirajganj: ['Belkuchi', 'Chauhali', 'Kamarkhanda', 'Kazipur', 'Raiganj', 'Shahjadpur', 'Sirajganj Sadar', 'Tarash', 'Ullahpara'],
  // Rangpur
  dinajpur: ['Birampur', 'Birganj', 'Biral', 'Bochaganj', 'Chirirbandar', 'Dinajpur Sadar', 'Fulbari', 'Ghoraghat', 'Hakimpur', 'Kaharole', 'Khansama', 'Nawabganj', 'Parbatipur'],
  gaibandha: ['Fulchhari', 'Gaibandha Sadar', 'Gobindaganj', 'Palashbari', 'Sadullapur', 'Saghata', 'Sundarganj'],
  kurigram: ['Bhurungamari', 'Char Rajibpur', 'Chilmari', 'Kurigram Sadar', 'Nageshwari', 'Phulbari', 'Rajarhat', 'Raumari', 'Ulipur'],
  lalmonirhat: ['Aditmari', 'Hatibandha', 'Kaliganj', 'Lalmonirhat Sadar', 'Patgram'],
  nilphamari: ['Dimla', 'Domar', 'Jaldhaka', 'Kishoreganj', 'Nilphamari Sadar', 'Saidpur'],
  panchagarh: ['Atwari', 'Boda', 'Debiganj', 'Panchagarh Sadar', 'Tetulia'],
  rangpur: ['Badarganj', 'Gangachara', 'Kaunia', 'Mithapukur', 'Pirgachha', 'Pirganj', 'Rangpur Sadar', 'Taraganj'],
  thakurgaon: ['Baliadangi', 'Haripur', 'Pirganj', 'Ranisankail', 'Thakurgaon Sadar'],
  // Sylhet
  habiganj: ['Ajmiriganj', 'Bahubal', 'Baniyachong', 'Chunarughat', 'Habiganj Sadar', 'Lakhai', 'Madhabpur', 'Nabiganj', 'Shayestaganj'],
  moulvibazar: ['Barlekha', 'Juri', 'Kamalganj', 'Kulaura', 'Moulvibazar Sadar', 'Rajnagar', 'Sreemangal'],
  sunamganj: ['Bishwamvarpur', 'Chhatak', 'Derai', 'Dharampasha', 'Dowarabazar', 'Jagannathpur', 'Jamalganj', 'Madhyanagar', 'Shantiganj', 'Sulla', 'Sunamganj Sadar', 'Tahirpur'],
  sylhet: ['Ambarkhana', 'Shahjalal Upashahar', 'Subidbazar', 'Zindabazar', 'Balaganj', 'Beanibazar', 'Bishwanath', 'Companiganj', 'Dakshin Surma', 'Fenchuganj', 'Golapganj',
    'Gowainghat', 'Jaintiapur', 'Kanaighat', 'Osmani Nagar', 'Sylhet Sadar', 'Zakiganj'],
  // Mymensingh
  jamalpur: ['Bakshiganj', 'Dewanganj', 'Islampur', 'Jamalpur Sadar', 'Madarganj', 'Melandaha', 'Sarishabari'],
  mymensingh: ['Bhaluka', 'Dhobaura', 'Fulbaria', 'Gaffargaon', 'Gauripur', 'Haluaghat', 'Ishwarganj', 'Muktagachha', 'Mymensingh Sadar', 'Nandail', 'Phulpur', 'Tarakanda', 'Trishal'],
  netrokona: ['Atpara', 'Barhatta', 'Durgapur', 'Kalmakanda', 'Kendua', 'Khaliajuri', 'Madan', 'Mohanganj', 'Netrokona Sadar', 'Purbadhala'],
  sherpur: ['Jhenaigati', 'Nakla', 'Nalitabari', 'Sherpur Sadar', 'Sreebardi']
};

module.exports = { AREAS };
