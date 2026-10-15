// Travelers' Century Club destination list (TCC list of 330, 2023 edition),
// with the rules used to map airports, trips and map polygons onto each
// destination.
//
//   n    Official TCC number(s). Destinations TCC splits across two
//        continents (Russia, Turkey, Egypt) are one entry here, carrying both
//        numbers, and are listed under both regions.
//   id   Stable id (defaults to the slugified name without its parenthesis).
//   also Extra regions the destination is listed under.
//
// Rule fields (all optional):
//   c   ISO 3166-1 alpha-2 codes this entry is the *default* for (anything in
//       that country not claimed by a more specific rule).
//   r   ISO 3166-2 region codes. Matches OurAirports `iso_region` and the
//       ADM1 polygon codes (the two datasets use different codes for some
//       countries, so both variants are listed where needed).
//   box [west, south, east, north] lon/lat box, only applied inside the
//       countries listed in `bc` (or `c`/`r` countries if `bc` is omitted).
//   ap  IATA codes forced to this entry (escape hatch for edge cases).
//   pt  [lon, lat] marker position, for entries without a polygon.
//
// Match priority: ap > box > r > c.
// After editing, run `npm run build:data` to regenerate data/tcc.json and
// data/tcc-shapes.json.

const PAC = 'Pacific Ocean';
const NAM = 'North America';
const CAM = 'Central America';
const SAM = 'South America';
const CAR = 'Caribbean';
const ATL = 'Atlantic Ocean';
const EUR = 'Europe & Mediterranean';
const ANT = 'Antarctica';
const AFR = 'Africa';
const MEA = 'Middle East';
const IND = 'Indian Ocean';
const ASI = 'Asia';

export const REGIONS = [PAC, NAM, CAM, SAM, CAR, ATL, EUR, ANT, AFR, MEA, IND, ASI];

const SCOTLAND = 'EAY EDU ERW GLG IVC NAY NLK RFW SAY SLK WDU ABE ABD MRY FAL STG CLK PKN ANS DND FIF ELN EDH MLN WLN SCB DGY ORK HLD AGB ZET ELS';
const WALES = 'CMN CGN PEM POW BGE CAY MTY RCT CRF VGL NTL SWA DEN FLN WRX AGY CWY GWN BGW MON NWP TOF';
const N_IRELAND = 'BFS DRY OMH ARM NYM BNB CGV DGN LSB CKT ANT MFT BLA LRN CKF NTA NDN DOW CLR BLY LMV CSR STB FER ARD MYL';

const pre = (cc, codes) => codes.split(' ').map((c) => `${cc}-${c}`);

/** @type {Array<{n:number[], name:string, region:string, id?:string, also?:string[], c?:string[], r?:string[], box?:number[], bc?:string[], ap?:string[], pt?:number[]}>} */
export const TCC = [
  // ---------------------------------------------------------- Pacific (40)
  { n: [1], name: 'Austral Islands', region: PAC, r: ['PF-X04~'], box: [-155, -28.5, -143, -21.5], bc: ['PF'] },
  { n: [2], name: 'Australia', region: PAC, c: ['AU'] },
  { n: [3], name: 'Bismarck Archipelago (Admiralty Islands, Bougainville, New Britain, New Ireland)', region: PAC, r: pre('PG', 'MRL NIK EBR WBK NSB') },
  { n: [4], name: 'Chatham Islands', region: PAC, r: ['NZ-CIT'], box: [-177.5, -45, -175.5, -43], bc: ['NZ'] },
  { n: [5], name: 'Cook Islands (Aitutaki, Penrhyn, Rarotonga)', region: PAC, c: ['CK'] },
  { n: [6], name: 'Easter Island', region: PAC, box: [-109.6, -27.4, -109.0, -26.9], bc: ['CL'] },
  { n: [7], name: 'Fiji Islands', region: PAC, c: ['FJ'] },
  { n: [8], name: 'French Polynesia (Gambier, Tahiti, Tuamotu)', region: PAC, c: ['PF'] },
  { n: [9], name: 'Galapagos Islands', region: PAC, r: ['EC-W'] },
  { n: [10], name: 'Guam', region: PAC, c: ['GU'] },
  { n: [11], name: 'Hawaiian Islands', region: PAC, r: ['US-HI'] },
  { n: [12], name: 'Juan Fernandez Islands (Robinson Crusoe Island)', region: PAC, box: [-81, -34, -78.6, -33.4], bc: ['CL'] },
  { n: [13], name: 'Kiribati (Gilberts, Tarawa, Ocean Island)', region: PAC, c: ['KI'], r: ['KI-G'], pt: [173.0, 1.4] },
  { n: [14], name: 'Line/Phoenix Islands (Canton, Christmas, Enderbury, Fanning)', region: PAC, r: ['KI-L', 'KI-P'], box: [-176, -12, -150, 7], bc: ['KI'] },
  { n: [15], name: 'Lord Howe Island', region: PAC, box: [158.9, -31.9, 159.4, -31.3], bc: ['AU'] },
  { n: [16], name: 'Marquesas Islands', region: PAC, r: ['PF-X05~'], box: [-141.5, -11, -137.5, -7.5], bc: ['PF'] },
  { n: [17], name: 'Marshall Islands, Republic of (Eniwetok, Kwajalein, Majuro)', region: PAC, id: 'marshall-islands', c: ['MH'] },
  { n: [18], name: 'Micronesia, Fed.States of (Caroline Islands, Chuuk, Kosrae, Pohnpei, Yap)', region: PAC, id: 'micronesia', c: ['FM'] },
  { n: [19], name: 'Midway Island', region: PAC, r: ['UM-71'], pt: [-177.37, 28.21] },
  { n: [20], name: 'Nauru', region: PAC, c: ['NR'] },
  { n: [21], name: 'New Caledonia & Dependencies (L’Île-des-Pins, Loyalty Islands)', region: PAC, c: ['NC'] },
  { n: [22], name: 'New Zealand', region: PAC, c: ['NZ'] },
  { n: [23], name: 'Niue', region: PAC, c: ['NU'] },
  { n: [24], name: 'Norfolk Island', region: PAC, c: ['NF'] },
  { n: [25], name: 'Northern Marianas (Saipan, Tinian)', region: PAC, c: ['MP'] },
  { n: [26], name: 'Ogasawara (Bonin, Iwo Jima, Volcano Island)', region: PAC, box: [136, 20, 154.5, 28], bc: ['JP'] },
  { n: [27], name: 'Palau, Republic of', region: PAC, id: 'palau', c: ['PW'] },
  { n: [28], name: 'Papua New Guinea', region: PAC, c: ['PG'] },
  { n: [29], name: 'Pitcairn Island', region: PAC, c: ['PN'] },
  { n: [30], name: 'Ryukyu Islands (Okinawa)', region: PAC, r: ['JP-47'] },
  { n: [31], name: 'Samoa, American', region: PAC, c: ['AS'] },
  { n: [32], name: 'Samoa', region: PAC, c: ['WS'] },
  { n: [33], name: 'Solomon Islands (Guadalcanal, New Georgia, Tulagi)', region: PAC, c: ['SB'] },
  { n: [34], name: 'Tasmania', region: PAC, r: ['AU-TAS'] },
  { n: [35], name: 'Tokelau Islands (Atafu, Fakaofu, Union)', region: PAC, c: ['TK'] },
  { n: [36], name: 'Tonga (Nukualofa)', region: PAC, c: ['TO'] },
  { n: [37], name: 'Tuvalu (Ellice Island, Funafuti, Vaitapu)', region: PAC, c: ['TV'] },
  { n: [38], name: 'Vanuatu (New Hebrides Islands)', region: PAC, c: ['VU'] },
  { n: [39], name: 'Wake Island', region: PAC, c: ['UM'], r: ['UM-79'], pt: [166.63, 19.29] },
  { n: [40], name: 'Wallis & Futuna Islands', region: PAC, c: ['WF'] },

  // ------------------------------------------------------ North America (6)
  { n: [41], name: 'Alaska', region: NAM, r: ['US-AK'] },
  { n: [42], name: 'Canada', region: NAM, c: ['CA'] },
  { n: [43], name: 'Mexico', region: NAM, c: ['MX'] },
  { n: [44], name: 'Prince Edward Island', region: NAM, r: ['CA-PE'] },
  { n: [45], name: 'St. Pierre & Miquelon', region: NAM, c: ['PM'] },
  { n: [46], name: 'United States (Contiguous)', region: NAM, c: ['US'] },

  // ---------------------------------------------------- Central America (7)
  { n: [47], name: 'Belize', region: CAM, c: ['BZ'] },
  { n: [48], name: 'Costa Rica', region: CAM, c: ['CR'] },
  { n: [49], name: 'El Salvador', region: CAM, c: ['SV'] },
  { n: [50], name: 'Guatemala', region: CAM, c: ['GT'] },
  { n: [51], name: 'Honduras', region: CAM, c: ['HN'] },
  { n: [52], name: 'Nicaragua', region: CAM, c: ['NI'] },
  { n: [53], name: 'Panama', region: CAM, c: ['PA'] },

  // ----------------------------------------------------- South America (14)
  { n: [54], name: 'Argentina', region: SAM, c: ['AR'] },
  { n: [55], name: 'Bolivia', region: SAM, c: ['BO'] },
  { n: [56], name: 'Brazil', region: SAM, c: ['BR'] },
  { n: [57], name: 'Chile', region: SAM, c: ['CL'] },
  { n: [58], name: 'Colombia', region: SAM, c: ['CO'] },
  { n: [59], name: 'Ecuador', region: SAM, c: ['EC'] },
  { n: [60], name: 'French Guiana', region: SAM, c: ['GF'], r: ['FR-GF'] },
  { n: [61], name: 'Guyana', region: SAM, c: ['GY'] },
  { n: [62], name: 'Nueva Esparta (Margarita Island)', region: SAM, r: ['VE-O'] },
  { n: [63], name: 'Paraguay', region: SAM, c: ['PY'] },
  { n: [64], name: 'Peru', region: SAM, c: ['PE'] },
  { n: [65], name: 'Suriname', region: SAM, c: ['SR'] },
  { n: [66], name: 'Uruguay', region: SAM, c: ['UY'] },
  { n: [67], name: 'Venezuela', region: SAM, c: ['VE'] },

  // --------------------------------------------------------- Caribbean (31)
  { n: [68], name: 'Anguilla', region: CAR, c: ['AI'] },
  { n: [69], name: 'Antigua & Barbuda', region: CAR, c: ['AG'] },
  { n: [70], name: 'Aruba', region: CAR, c: ['AW'] },
  { n: [71], name: 'Bahamas', region: CAR, c: ['BS'] },
  { n: [72], name: 'Barbados', region: CAR, c: ['BB'] },
  { n: [73], name: 'Bonaire', region: CAR, c: ['BQ'], box: [-68.5, 11.9, -68.0, 12.4], bc: ['BQ', 'NL'] },
  { n: [74], name: 'Cayman Islands', region: CAR, c: ['KY'] },
  { n: [75], name: 'Cuba', region: CAR, c: ['CU'] },
  { n: [76], name: 'Curacao', region: CAR, c: ['CW'] },
  { n: [77], name: 'Dominica', region: CAR, c: ['DM'] },
  { n: [78], name: 'Dominican Republic', region: CAR, c: ['DO'] },
  { n: [79], name: 'Grenada & Dependencies (Carriacou, Grenadines)', region: CAR, c: ['GD'] },
  { n: [80], name: 'Guadeloupe & Dependencies (Marie Galante)', region: CAR, c: ['GP'], r: ['FR-GP'] },
  { n: [81], name: 'Haiti', region: CAR, c: ['HT'] },
  { n: [82], name: 'Jamaica', region: CAR, c: ['JM'] },
  { n: [83], name: 'Martinique', region: CAR, c: ['MQ'], r: ['FR-MQ'] },
  { n: [84], name: 'Montserrat', region: CAR, c: ['MS'] },
  { n: [85], name: 'Nevis', region: CAR, r: pre('KN', '04 05 07 10 12'), ap: ['NEV'] },
  { n: [86], name: 'Puerto Rico', region: CAR, c: ['PR'], r: ['US-PR'] },
  { n: [87], name: 'Saba & Sint Eustatius', region: CAR, box: [-63.3, 17.4, -62.9, 17.7], bc: ['BQ', 'NL'] },
  { n: [88], name: 'St. Barthélemy', region: CAR, c: ['BL'] },
  { n: [89], name: 'St. Kitts', region: CAR, c: ['KN'] },
  { n: [90], name: 'St. Lucia', region: CAR, c: ['LC'] },
  { n: [91], name: 'St. Martin (France)', region: CAR, c: ['MF'] },
  { n: [92], name: 'St. Vincent & the Grenadines', region: CAR, c: ['VC'] },
  { n: [93], name: 'San Andres & Providencia', region: CAR, r: ['CO-SAP'] },
  { n: [94], name: 'Sint Maarten (Netherlands)', region: CAR, c: ['SX'], r: ['NL-SX'] },
  { n: [95], name: 'Trinidad & Tobago', region: CAR, c: ['TT'] },
  { n: [96], name: 'Turks & Caicos Islands', region: CAR, c: ['TC'] },
  { n: [97], name: 'Virgin Islands, British (Tortola, etc.)', region: CAR, c: ['VG'] },
  { n: [98], name: 'Virgin Islands, U.S. (St. Croix, St. John, St. Thomas)', region: CAR, c: ['VI'] },

  // ---------------------------------------------------- Atlantic Ocean (14)
  { n: [99], name: 'Ascension', region: ATL, r: ['SH-AC'] },
  { n: [100], name: 'Azores Islands', region: ATL, r: ['PT-20'] },
  { n: [101], name: 'Bermuda', region: ATL, c: ['BM'] },
  { n: [102], name: 'Canary Islands', region: ATL, r: ['ES-CN', 'ES-GC', 'ES-TF'] },
  { n: [103], name: 'Cape Verde Islands', region: ATL, c: ['CV'] },
  { n: [104], name: 'Falkland Islands', region: ATL, c: ['FK'] },
  { n: [105], name: 'Faroe Islands', region: ATL, c: ['FO'] },
  { n: [106], name: 'Fernando de Noronha', region: ATL, box: [-32.6, -4.0, -32.3, -3.7], bc: ['BR'] },
  { n: [107], name: 'Greenland (Kalaallit Nunaat)', region: ATL, c: ['GL'] },
  { n: [108], name: 'Iceland', region: ATL, c: ['IS'] },
  { n: [109], name: 'Madeira', region: ATL, r: ['PT-30'] },
  { n: [110], name: 'South Georgia & the South Sandwich Islands', region: ATL, c: ['GS'] },
  { n: [111], name: 'St. Helena', region: ATL, c: ['SH'], r: ['SH-HL', 'SH-SH'] },
  { n: [112], name: 'Tristan da Cunha', region: ATL, r: ['SH-TA'] },

  // -------------------------------------------- Europe & Mediterranean (68)
  { n: [113], name: 'Aland Islands', region: EUR, c: ['AX'] },
  { n: [114], name: 'Albania', region: EUR, c: ['AL'] },
  { n: [115], name: 'Andorra', region: EUR, c: ['AD'] },
  { n: [116], name: 'Austria', region: EUR, c: ['AT'] },
  { n: [117], name: 'Balearic Islands (Ibiza, Mallorca, Minorca)', region: EUR, r: ['ES-IB', 'ES-PM'] },
  { n: [118], name: 'Belarus', region: EUR, c: ['BY'] },
  { n: [119], name: 'Belgium', region: EUR, c: ['BE'] },
  { n: [120], name: 'Bosnia & Herzegovina', region: EUR, c: ['BA'] },
  { n: [121], name: 'Bulgaria', region: EUR, c: ['BG'] },
  { n: [122], name: 'Corsica', region: EUR, r: ['FR-COR', 'FR-2A', 'FR-2B'] },
  { n: [123], name: 'Crete', region: EUR, r: ['GR-M'] },
  { n: [124], name: 'Croatia', region: EUR, c: ['HR'] },
  { n: [125], name: 'Cyprus, British Sovereign Base Areas of Akrotiri & Dhekelia', region: EUR, id: 'cyprus-british-bases', c: ['XB'] },
  { n: [126], name: 'Cyprus, Republic', region: EUR, c: ['CY'] },
  { n: [127], name: 'Cyprus, Turkish Fed. State', region: EUR, c: ['XN'], ap: ['ECN', 'GEC'] },
  { n: [128], name: 'Czech Republic', region: EUR, c: ['CZ'] },
  { n: [129], name: 'Denmark', region: EUR, c: ['DK'] },
  { n: [130], name: 'England', region: EUR, c: ['GB'], r: ['GB-ENG'] },
  { n: [131], name: 'Estonia', region: EUR, c: ['EE'] },
  { n: [132], name: 'Finland', region: EUR, c: ['FI'] },
  { n: [133], name: 'France', region: EUR, c: ['FR'] },
  { n: [134], name: 'Germany', region: EUR, c: ['DE'] },
  { n: [135], name: 'Gibraltar', region: EUR, c: ['GI'] },
  { n: [136], name: 'Greece', region: EUR, c: ['GR'] },
  { n: [137], name: 'Greek Aegean Islands (Cyclades, Dodecanese, Northern Aegean Islands)', region: EUR, r: ['GR-K', 'GR-L'] },
  { n: [138], name: 'Guernsey & Dependencies (Alderney, Herm, Sark)', region: EUR, c: ['GG'] },
  { n: [139], name: 'Hungary', region: EUR, c: ['HU'] },
  { n: [140], name: 'Ionian Islands (Corfu, etc.)', region: EUR, r: ['GR-F'] },
  { n: [141], name: 'Ireland (Eire)', region: EUR, c: ['IE'] },
  { n: [142], name: 'Ireland, Northern', region: EUR, r: ['GB-NIR', ...pre('GB', N_IRELAND)] },
  { n: [143], name: 'Isle of Man', region: EUR, c: ['IM'] },
  { n: [144], name: 'Italy', region: EUR, c: ['IT'] },
  { n: [145], name: 'Jersey', region: EUR, c: ['JE'] },
  { n: [146], name: 'Kaliningrad', region: EUR, r: ['RU-KGD'] },
  { n: [147], name: 'Kosovo', region: EUR, c: ['XK'] },
  { n: [148], name: 'Lampedusa', region: EUR, box: [12.3, 35.45, 12.9, 35.9], bc: ['IT'] },
  { n: [149], name: 'Latvia', region: EUR, c: ['LV'] },
  { n: [150], name: 'Liechtenstein', region: EUR, c: ['LI'] },
  { n: [151], name: 'Lithuania', region: EUR, c: ['LT'] },
  { n: [152], name: 'Luxembourg', region: EUR, c: ['LU'] },
  { n: [153], name: 'Malta', region: EUR, c: ['MT'] },
  { n: [154], name: 'Moldova', region: EUR, c: ['MD'] },
  { n: [155], name: 'Monaco', region: EUR, c: ['MC'] },
  { n: [156], name: 'Montenegro', region: EUR, c: ['ME'] },
  { n: [157], name: 'Netherlands', region: EUR, c: ['NL'] },
  { n: [158], name: 'North Macedonia', region: EUR, c: ['MK'] },
  { n: [159], name: 'Norway', region: EUR, c: ['NO', 'SJ'] },
  { n: [160], name: 'Poland', region: EUR, c: ['PL'] },
  { n: [161], name: 'Portugal', region: EUR, c: ['PT'] },
  { n: [162], name: 'Romania', region: EUR, c: ['RO'] },
  // TCC counts "Russia" (Europe, #163) and "Russia in Asia" (#313) separately.
  { n: [163, 313], name: 'Russia', region: EUR, also: [ASI], c: ['RU'] },
  { n: [164], name: 'San Marino', region: EUR, c: ['SM'] },
  { n: [165], name: 'Sardinia', region: EUR, r: ['IT-88', ...pre('IT', 'CI VS OR SS OT NU OG CA SU')] },
  { n: [166], name: 'Scotland', region: EUR, r: ['GB-SCT', ...pre('GB', SCOTLAND)] },
  { n: [167], name: 'Serbia', region: EUR, c: ['RS'] },
  { n: [168], name: 'Sicily', region: EUR, r: ['IT-82', ...pre('IT', 'TP PA ME EN CT SR RG CL AG')] },
  { n: [169], name: 'Slovakia', region: EUR, c: ['SK'] },
  { n: [170], name: 'Slovenia', region: EUR, c: ['SI'] },
  { n: [171], name: 'Spain', region: EUR, c: ['ES'] },
  { n: [172], name: 'Spitsbergen (Svalbard, Bear Island)', region: EUR, r: ['NO-21'], box: [10, 74, 35, 81], bc: ['NO', 'SJ'] },
  { n: [173], name: 'Srpska', region: EUR, r: ['BA-SRP', ...pre('BA', 'X01~ X02~ X03~ X04~ X05~ X06~ X07~')] },
  { n: [174], name: 'Sweden', region: EUR, c: ['SE'] },
  { n: [175], name: 'Switzerland', region: EUR, c: ['CH'] },
  { n: [176], name: 'Transnistria (Pridnestrovie)', region: EUR, r: ['MD-SN', 'MD-GRI', 'MD-CAM', 'MD-BD'] },
  // TCC counts "Turkey in Europe" (#177) and "Turkey in Asia" (#327) separately.
  { n: [177, 327], name: 'Turkey', region: EUR, also: [ASI], c: ['TR'] },
  { n: [178], name: 'Ukraine', region: EUR, c: ['UA'] },
  { n: [179], name: 'Vatican City', region: EUR, c: ['VA'] },
  { n: [180], name: 'Wales', region: EUR, r: ['GB-WLS', ...pre('GB', WALES)] },

  // -------------------------------------------------------- Antarctica (7)
  // Overlapping claims share one polygon, so these are shown as markers.
  { n: [181], name: 'Argentine Antarctica (Antarctic Peninsula)', region: ANT, pt: [-55, -78] },
  { n: [182], name: 'Australian Antarctic Territory (Davis, Heard, Macquarie, Mawson)', region: ANT, c: ['HM'], r: ['AU-X03~'], pt: [100, -75] },
  { n: [183], name: 'British Antarctic Territory (Antarctic Peninsula, Graham Land, So. Orkney, So. Shetland)', region: ANT, pt: [-63, -66] },
  { n: [184], name: 'Chilean Antarctic Territory (Antarctic Peninsula)', region: ANT, pt: [-75, -80] },
  { n: [185], name: 'French Antarctica (Adélie, Kerguelen)', region: ANT, c: ['TF'], pt: [139, -68] },
  { n: [186], name: 'New Zealand Antarctica (Ross Dependency)', region: ANT, pt: [175, -80] },
  { n: [187], name: 'Norwegian Dependencies (Bouvet, Peter I Island, Queen Maud Land)', region: ANT, c: ['BV'], r: ['NO-X01~'], pt: [10, -73] },

  // ------------------------------------------------------------ Africa (55)
  { n: [188], name: 'Algeria', region: AFR, c: ['DZ'] },
  { n: [189], name: 'Angola', region: AFR, c: ['AO'] },
  { n: [190], name: 'Benin', region: AFR, c: ['BJ'] },
  { n: [191], name: 'Botswana', region: AFR, c: ['BW'] },
  { n: [192], name: 'Burkina Faso', region: AFR, c: ['BF'] },
  { n: [193], name: 'Burundi', region: AFR, c: ['BI'] },
  { n: [194], name: 'Cabinda', region: AFR, r: ['AO-CAB'] },
  { n: [195], name: 'Cameroon', region: AFR, c: ['CM'] },
  { n: [196], name: 'Central African Republic', region: AFR, c: ['CF'] },
  { n: [197], name: 'Chad', region: AFR, c: ['TD'] },
  { n: [198], name: 'Congo, Democratic Republic of (Kinshasa)', region: AFR, id: 'congo-kinshasa', c: ['CD'] },
  { n: [199], name: 'Congo, Republic of (Brazzaville)', region: AFR, id: 'congo-brazzaville', c: ['CG'] },
  { n: [200], name: 'Côte d’Ivoire (Ivory Coast)', region: AFR, c: ['CI'] },
  { n: [201], name: 'Djibouti', region: AFR, c: ['DJ'] },
  // TCC counts "Egypt in Africa" (#202) and "Egypt in Asia (Sinai)" (#247) separately.
  { n: [202, 247], name: 'Egypt', region: AFR, also: [MEA], c: ['EG'] },
  { n: [203], name: 'Equatorial Guinea (Bioko)', region: AFR, id: 'equatorial-guinea-bioko', r: ['GQ-BN', 'GQ-BS', 'GQ-AN'] },
  { n: [204], name: 'Equatorial Guinea (Rio Muni)', region: AFR, id: 'equatorial-guinea-rio-muni', c: ['GQ'] },
  { n: [205], name: 'Eritrea', region: AFR, c: ['ER'] },
  { n: [206], name: 'Eswatini (Swaziland)', region: AFR, c: ['SZ'] },
  { n: [207], name: 'Ethiopia', region: AFR, c: ['ET'] },
  { n: [208], name: 'Gabon', region: AFR, c: ['GA'] },
  { n: [209], name: 'Gambia, The', region: AFR, c: ['GM'] },
  { n: [210], name: 'Ghana', region: AFR, c: ['GH'] },
  { n: [211], name: 'Guinea', region: AFR, c: ['GN'] },
  { n: [212], name: 'Guinea-Bissau', region: AFR, c: ['GW'] },
  { n: [213], name: 'Kenya', region: AFR, c: ['KE'] },
  { n: [214], name: 'Lesotho', region: AFR, c: ['LS'] },
  { n: [215], name: 'Liberia', region: AFR, c: ['LR'] },
  { n: [216], name: 'Libya', region: AFR, c: ['LY'] },
  { n: [217], name: 'Malawi', region: AFR, c: ['MW'] },
  { n: [218], name: 'Mali', region: AFR, c: ['ML'] },
  { n: [219], name: 'Mauritania', region: AFR, c: ['MR'] },
  { n: [220], name: 'Morocco', region: AFR, c: ['MA'] },
  { n: [221], name: 'Morocco, Spanish (Ceuta, Melilla)', region: AFR, r: ['ES-CE', 'ES-ML'] },
  { n: [222], name: 'Mozambique', region: AFR, c: ['MZ'] },
  { n: [223], name: 'Namibia', region: AFR, c: ['NA'] },
  { n: [224], name: 'Niger', region: AFR, c: ['NE'] },
  { n: [225], name: 'Nigeria', region: AFR, c: ['NG'] },
  { n: [226], name: 'Rwanda', region: AFR, c: ['RW'] },
  { n: [227], name: 'Sao Tome & Principe', region: AFR, c: ['ST'] },
  { n: [228], name: 'Senegal', region: AFR, c: ['SN'] },
  { n: [229], name: 'Sierra Leone', region: AFR, c: ['SL'] },
  { n: [230], name: 'Somalia (Italian Somaliland)', region: AFR, c: ['SO'] },
  { n: [231], name: 'Somaliland (British)', region: AFR, c: ['XS'], r: ['SO-WO', 'SO-AW', 'SO-TO', 'SO-SA', 'SO-SO'] },
  { n: [232], name: 'South Africa', region: AFR, c: ['ZA'] },
  { n: [233], name: 'South Sudan', region: AFR, c: ['SS'] },
  { n: [234], name: 'Sudan', region: AFR, c: ['SD'] },
  { n: [235], name: 'Tanzania', region: AFR, c: ['TZ'] },
  { n: [236], name: 'Togo', region: AFR, c: ['TG'] },
  { n: [237], name: 'Tunisia', region: AFR, c: ['TN'] },
  { n: [238], name: 'Uganda', region: AFR, c: ['UG'] },
  { n: [239], name: 'Western Sahara', region: AFR, c: ['EH'], box: [-17.2, 20.7, -8.7, 27.66], bc: ['MA'] },
  { n: [240], name: 'Zambia', region: AFR, c: ['ZM'] },
  { n: [241], name: 'Zanzibar', region: AFR, r: pre('TZ', '06 07 10 11 15'), box: [39.15, -6.5, 39.95, -4.85], bc: ['TZ'] },
  { n: [242], name: 'Zimbabwe', region: AFR, c: ['ZW'] },

  // ------------------------------------------------------- Middle East (21)
  { n: [243], name: 'Abu Dhabi', region: MEA, c: ['AE'], r: ['AE-AZ'] },
  { n: [244], name: 'Ajman', region: MEA, r: ['AE-AJ'] },
  { n: [245], name: 'Bahrain', region: MEA, c: ['BH'] },
  { n: [246], name: 'Dubai', region: MEA, r: ['AE-DU'] },
  { n: [248], name: 'Fujairah', region: MEA, r: ['AE-FU'] },
  { n: [249], name: 'Iran', region: MEA, c: ['IR'] },
  { n: [250], name: 'Iraq', region: MEA, c: ['IQ'] },
  { n: [251], name: 'Israel', region: MEA, c: ['IL'] },
  { n: [252], name: 'Jordan', region: MEA, c: ['JO'] },
  { n: [253], name: 'Kuwait', region: MEA, c: ['KW'] },
  { n: [254], name: 'Lebanon', region: MEA, c: ['LB'] },
  { n: [255], name: 'Oman', region: MEA, c: ['OM'] },
  { n: [256], name: 'Palestine', region: MEA, c: ['PS'] },
  { n: [257], name: 'Qatar', region: MEA, c: ['QA'] },
  { n: [258], name: 'Ras Al Khaimah', region: MEA, r: ['AE-RK'] },
  { n: [259], name: 'Saudi Arabia', region: MEA, c: ['SA'] },
  { n: [260], name: 'Sharjah', region: MEA, r: ['AE-SH'] },
  { n: [261], name: 'Syria', region: MEA, c: ['SY'] },
  { n: [262], name: 'Umm Al Qaiwain', region: MEA, r: ['AE-UQ'] },
  { n: [263], name: 'Yemen', region: MEA, c: ['YE'] },

  // ------------------------------------------------------ Indian Ocean (15)
  { n: [264], name: 'Andaman-Nicobar Islands', region: IND, r: ['IN-AN'] },
  { n: [265], name: 'British Indian Ocean Territory (Chagos Archipelago, Diego Garcia)', region: IND, c: ['IO'] },
  { n: [266], name: 'Christmas Island', region: IND, c: ['CX'] },
  { n: [267], name: 'Cocos (Keeling) Islands', region: IND, c: ['CC'], box: [96.7, -12.3, 97.0, -11.8], bc: ['CX'] },
  { n: [268], name: 'Comoros (Anjouan, Grand Comoro, Moheli)', region: IND, c: ['KM'] },
  { n: [269], name: 'Lakshadweep', region: IND, r: ['IN-LD'] },
  { n: [270], name: 'Madagascar', region: IND, c: ['MG'] },
  { n: [271], name: 'Maldives', region: IND, c: ['MV'] },
  { n: [272], name: 'Mauritius & Dependencies (Agalega, St. Brandon)', region: IND, c: ['MU'] },
  { n: [273], name: 'Mayotte (Dzaoudzi)', region: IND, c: ['YT'], r: ['FR-YT'] },
  { n: [274], name: 'Reunion', region: IND, c: ['RE'], r: ['FR-RE'] },
  { n: [275], name: 'Rodrigues Island', region: IND, r: ['MU-RO'], box: [63.0, -20.0, 63.6, -19.5], bc: ['MU'] },
  { n: [276], name: 'Seychelles', region: IND, c: ['SC'] },
  { n: [277], name: 'Socotra', region: IND, box: [52.0, 11.9, 54.6, 13.0], bc: ['YE'] },
  { n: [278], name: 'Zil Elwannyen Sesel (Aldabra, Amirante Islands, Farquhar)', region: IND, r: ['SC-X02~'], box: [45.5, -11, 54.0, -3.5], bc: ['SC'] },

  // -------------------------------------------------------------- Asia (52)
  { n: [279], name: 'Abkhazia', region: ASI, r: ['GE-AB'] },
  { n: [280], name: 'Afghanistan', region: ASI, c: ['AF'] },
  { n: [281], name: 'Armenia', region: ASI, c: ['AM'] },
  { n: [282], name: 'Azerbaijan', region: ASI, c: ['AZ'] },
  { n: [283], name: 'Bangladesh', region: ASI, c: ['BD'] },
  { n: [284], name: 'Bhutan', region: ASI, c: ['BT'] },
  { n: [285], name: 'Brunei', region: ASI, c: ['BN'] },
  { n: [286], name: 'Cambodia', region: ASI, c: ['KH'] },
  { n: [287], name: 'China, People’s Republic', region: ASI, c: ['CN'] },
  { n: [288], name: 'Georgia', region: ASI, c: ['GE'] },
  { n: [289], name: 'Hainan Island', region: ASI, r: ['CN-HI', 'CN-46'] },
  { n: [290], name: 'Hong Kong', region: ASI, c: ['HK'] },
  { n: [291], name: 'India', region: ASI, c: ['IN'] },
  { n: [292], name: 'Indonesia (Java)', region: ASI, id: 'indonesia-java', c: ['ID'], r: pre('ID', 'BT JB JK JT JI YO') },
  { n: [293], name: 'Japan', region: ASI, c: ['JP'] },
  { n: [294], name: 'Jeju Island (South Korea)', region: ASI, r: ['KR-49'] },
  { n: [295], name: 'Kalimantan (Indonesian Borneo)', region: ASI, r: pre('ID', 'KB KT KS KI KU') },
  { n: [296], name: 'Kashmir', region: ASI, r: ['IN-JK', 'IN-LA', 'PK-JK', 'PK-GB'] },
  { n: [297], name: 'Kazakhstan', region: ASI, c: ['KZ'] },
  { n: [298], name: 'Korea, North', region: ASI, c: ['KP'] },
  { n: [299], name: 'Korea, South', region: ASI, c: ['KR'] },
  { n: [300], name: 'Kyrgyzstan', region: ASI, c: ['KG'] },
  { n: [301], name: 'Laos', region: ASI, c: ['LA'] },
  { n: [302], name: 'Lesser Sunda Islands (Bali, Timor, Indonesia)', region: ASI, r: pre('ID', 'BA NB NT') },
  { n: [303], name: 'Macau', region: ASI, c: ['MO'] },
  { n: [304], name: 'Malaysia', region: ASI, c: ['MY'] },
  { n: [305], name: 'Maluku Islands', region: ASI, r: pre('ID', 'MA MU') },
  { n: [306], name: 'Mongolia, Republic', region: ASI, id: 'mongolia', c: ['MN'] },
  { n: [307], name: 'Myanmar (Burma)', region: ASI, c: ['MM'] },
  { n: [308], name: 'Nakhchivan', region: ASI, box: [44.7, 38.8, 46.2, 39.8], bc: ['AZ'] },
  { n: [309], name: 'Nepal', region: ASI, c: ['NP'] },
  { n: [310], name: 'Pakistan', region: ASI, c: ['PK'] },
  { n: [311], name: 'Papua (Irian Jaya)', region: ASI, r: pre('ID', 'PA PB PP PT PS PD') },
  { n: [312], name: 'Philippines', region: ASI, c: ['PH'] },
  { n: [314], name: 'Sabah (North Borneo)', region: ASI, r: ['MY-12', 'MY-15'] },
  { n: [315], name: 'Sarawak', region: ASI, r: ['MY-13'] },
  { n: [316], name: 'Sikkim', region: ASI, r: ['IN-SK'] },
  { n: [317], name: 'Singapore', region: ASI, c: ['SG'] },
  { n: [318], name: 'South Ossetia', region: ASI, pt: [44.0, 42.3] },
  { n: [319], name: 'Sri Lanka (Ceylon)', region: ASI, c: ['LK'] },
  { n: [320], name: 'Sulawesi (Celebes, Indonesia)', region: ASI, r: pre('ID', 'SN SR GO SA ST SG') },
  { n: [321], name: 'Sumatra (Indonesia)', region: ASI, r: pre('ID', 'AC SU SB RI JA SS BE LA BB KR') },
  { n: [322], name: 'Taiwan. R.O.C.', region: ASI, id: 'taiwan', c: ['TW'] },
  { n: [323], name: 'Tajikistan', region: ASI, c: ['TJ'] },
  { n: [324], name: 'Thailand', region: ASI, c: ['TH'] },
  { n: [325], name: 'Tibet', region: ASI, r: ['CN-XZ', 'CN-54'] },
  { n: [326], name: 'Timor-Leste', region: ASI, c: ['TL'] },
  { n: [328], name: 'Turkmenistan', region: ASI, c: ['TM'] },
  { n: [329], name: 'Uzbekistan', region: ASI, c: ['UZ'] },
  { n: [330], name: 'Vietnam', region: ASI, c: ['VN'] },
];

export const idOf = (e) => e.id || slug(e.name.replace(/\s*\(.*\)\s*$/, ''));

export function slug(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
