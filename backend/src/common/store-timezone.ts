const US_STATE_CODES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
};

const US_STATE_ALIASES: Record<string, string> = {
  'new jeresy': 'NJ', southcarolina: 'SC', 'd.c.': 'DC', dc: 'DC',
};

const US_STATE_ZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Denver',
  IL: 'America/Chicago', IN: 'America/New_York', IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago',
  ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York', MI: 'America/New_York', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York',
  NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver',
};

const OTHER_REGION_CODES: Record<string, string> = {
  Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB', 'Newfoundland and Labrador': 'NL', 'Nova Scotia': 'NS',
  Ontario: 'ON', 'Prince Edward Island': 'PE', Quebec: 'QC', Saskatchewan: 'SK', Yukon: 'YT', 'Northwest Territories': 'NT', Nunavut: 'NU',
};
const OTHER_REGION_ZONES: Record<string, string> = {
  AB: 'America/Edmonton', BC: 'America/Vancouver', MB: 'America/Winnipeg', NB: 'America/Moncton', NL: 'America/St_Johns',
  NS: 'America/Halifax', ON: 'America/Toronto', PE: 'America/Halifax', QC: 'America/Toronto', SK: 'America/Regina',
  YT: 'America/Whitehorse', NT: 'America/Yellowknife', NU: 'America/Iqaluit', CN: 'Asia/Shanghai',
};

const CITY_ZONE_OVERRIDES: Record<string, string> = {
  'pensacola|FL': 'America/Chicago', 'panama city|FL': 'America/Chicago', 'destin|FL': 'America/Chicago', 'fort walton beach|FL': 'America/Chicago',
  'crestview|FL': 'America/Chicago', 'niceville|FL': 'America/Chicago', 'marianna|FL': 'America/Chicago', 'chipley|FL': 'America/Chicago',
  'bonifay|FL': 'America/Chicago',
  'defuniak springs|FL': 'America/Chicago', 'milton|FL': 'America/Chicago', 'navarre|FL': 'America/Chicago', 'cantonment|FL': 'America/Chicago',
  'gulf breeze|FL': 'America/Chicago', 'freeport|FL': 'America/Chicago',
  'gary|IN': 'America/Chicago', 'hammond|IN': 'America/Chicago', 'michigan city|IN': 'America/Chicago', 'la porte|IN': 'America/Chicago',
  'valparaiso|IN': 'America/Chicago', 'chesterton|IN': 'America/Chicago', 'portage|IN': 'America/Chicago', 'crown point|IN': 'America/Chicago',
  'merrillville|IN': 'America/Chicago', 'hobart|IN': 'America/Chicago', 'east chicago|IN': 'America/Chicago', 'griffith|IN': 'America/Chicago',
  'dyer|IN': 'America/Chicago', 'munster|IN': 'America/Chicago', 'highland|IN': 'America/Chicago', 'schererville|IN': 'America/Chicago',
  'knox|IN': 'America/Chicago', 'kouts|IN': 'America/Chicago', 'hebron|IN': 'America/Chicago', 'burns harbor|IN': 'America/Chicago',
  'whiting|IN': 'America/Chicago', 'evansville|IN': 'America/Chicago', 'newburgh|IN': 'America/Chicago', 'boonville|IN': 'America/Chicago',
  'rockport|IN': 'America/Chicago', 'tell city|IN': 'America/Chicago', 'mount vernon|IN': 'America/Chicago', 'poseyville|IN': 'America/Chicago',
  'princeton|IN': 'America/Chicago',
  'bowling green|KY': 'America/Chicago', 'owensboro|KY': 'America/Chicago', 'paducah|KY': 'America/Chicago', 'hopkinsville|KY': 'America/Chicago',
  'henderson|KY': 'America/Chicago', 'madisonville|KY': 'America/Chicago', 'murray|KY': 'America/Chicago', 'mayfield|KY': 'America/Chicago',
  'benton|KY': 'America/Chicago', 'franklin|KY': 'America/Chicago', 'knoxville|TN': 'America/New_York', 'chattanooga|TN': 'America/New_York',
  'johnson city|TN': 'America/New_York', 'kingsport|TN': 'America/New_York', 'bristol|TN': 'America/New_York', 'cleveland|TN': 'America/New_York',
  'maryville|TN': 'America/New_York', 'oak ridge|TN': 'America/New_York', 'sevierville|TN': 'America/New_York', 'morristown|TN': 'America/New_York',
  'greeneville|TN': 'America/New_York',
  'menominee|MI': 'America/Chicago', 'iron mountain|MI': 'America/Chicago', 'ironwood|MI': 'America/Chicago', 'kingsford|MI': 'America/Chicago',
  'crystal falls|MI': 'America/Chicago', 'iron river|MI': 'America/Chicago', 'wakefield|MI': 'America/Chicago', 'bessemer|MI': 'America/Chicago',
  'coeur d alene|ID': 'America/Los_Angeles', 'sandpoint|ID': 'America/Los_Angeles', 'lewiston|ID': 'America/Los_Angeles', 'moscow|ID': 'America/Los_Angeles',
  'post falls|ID': 'America/Los_Angeles', 'hayden|ID': 'America/Los_Angeles', 'rathdrum|ID': 'America/Los_Angeles', 'bonners ferry|ID': 'America/Los_Angeles',
  'wallace|ID': 'America/Los_Angeles', 'ontario|OR': 'America/Denver', 'nyssa|OR': 'America/Denver', 'vale|OR': 'America/Denver',
  'adrian|OR': 'America/Denver', 'jordan valley|OR': 'America/Denver', 'goodland|KS': 'America/Denver', 'sharon springs|KS': 'America/Denver',
  'wallace|KS': 'America/Denver', 'tribune|KS': 'America/Denver', 'gering|NE': 'America/Denver', 'scottsbluff|NE': 'America/Denver',
  'chadron|NE': 'America/Denver', 'alliance|NE': 'America/Denver', 'kimball|NE': 'America/Denver', 'sidney|NE': 'America/Denver',
  'ogallala|NE': 'America/Denver', 'dickinson|ND': 'America/Denver', 'bowman|ND': 'America/Denver',
  'beach|ND': 'America/Denver', 'rapid city|SD': 'America/Denver', 'spearfish|SD': 'America/Denver',
  'sturgis|SD': 'America/Denver', 'deadwood|SD': 'America/Denver', 'custer|SD': 'America/Denver', 'hot springs|SD': 'America/Denver',
  'wall|SD': 'America/Denver', 'el paso|TX': 'America/Denver', 'sierra blanca|TX': 'America/Denver', 'adak|AK': 'America/Adak',
  'atka|AK': 'America/Adak', 'anchorage mat su|AK': 'America/Anchorage',
};

const ZIP_STATE_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'],
  [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'],
  [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'],
  [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'],
  [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'],
  [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];

function normalizeCity(value: string) {
  return value.trim().toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[.'’]/g, '').replace(/[-]+/g, ' ').replace(/\s+/g, ' ');
}

function zipDigits(value: string) {
  return /^\d{5}(?:-\d{4})?$/.test(value.trim()) ? value.trim().slice(0, 5) : '';
}

export function usStateCode(value: string) {
  const key = value.trim().toLocaleLowerCase();
  return US_STATE_ALIASES[key]
    || Object.entries(US_STATE_CODES).find(([name]) => name.toLocaleLowerCase() === key)?.[1]
    || (Object.values(US_STATE_CODES).includes(value.trim().toUpperCase()) ? value.trim().toUpperCase() : '');
}

export function usStateCodeFromZip(zipCode: string) {
  const digits = zipDigits(zipCode);
  if (!digits) return '';
  // Postal exceptions cross the otherwise useful state-prefix ranges.
  const exceptions: Record<string, string> = { '06390': 'NY', '73301': 'TX', '73344': 'TX', '20588': 'MD', '20598': 'VA' };
  if (exceptions[digits]) return exceptions[digits];
  const prefix = Number(digits.slice(0, 3));
  return ZIP_STATE_RANGES.find(([minimum, maximum]) => prefix >= minimum && prefix <= maximum)?.[2] ?? '';
}

export function storeZipStateConflict(state: string, zipCode: string) {
  const enteredState = usStateCode(state), zipState = usStateCodeFromZip(zipCode);
  return enteredState && zipState && enteredState !== zipState ? { enteredState, zipState } : null;
}

export function inferStoreTimezone(city: string, state: string, zipCode = '') {
  const stateKey = state.trim().toLocaleLowerCase();
  const zipCodeForState = !state.trim() || ['undefined', 'null', 'n/a'].includes(stateKey) ? usStateCodeFromZip(zipCode) : '';
  const normalizedRegion = stateKey.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[.\s]/g, '');
  if (['中国', '重庆市', '重庆', '广东省', '广东', 'china', 'chongqing', 'guangdong'].includes(normalizedRegion)) return OTHER_REGION_ZONES.CN;
  const otherCode = Object.entries(OTHER_REGION_CODES).find(([name]) => name.toLocaleLowerCase().replace(/\s/g, '') === normalizedRegion)?.[1]
    || (Object.prototype.hasOwnProperty.call(OTHER_REGION_ZONES, state.trim().toUpperCase()) ? state.trim().toUpperCase() : '');
  const regionCode = usStateCode(state) || otherCode || zipCodeForState;
  if (!regionCode) return '';
  // ZIP delivery prefixes are not timezone boundaries. An entered city/state
  // must also keep its zone while a user replaces a stale ZIP from another state.
  return CITY_ZONE_OVERRIDES[`${normalizeCity(city)}|${regionCode}`] ?? US_STATE_ZONES[regionCode] ?? OTHER_REGION_ZONES[regionCode] ?? '';
}
