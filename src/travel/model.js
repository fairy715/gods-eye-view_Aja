/**
 * Travel assist: reading a pasted location, ranking what is near it, and the
 * per-country lookups. Pure — no Cesium, DOM or network.
 * @module travel/model
 */

/** Categories listed around the traveller, in the order they are shown. */
export const TRAVEL_CATEGORIES = Object.freeze([
  'police',
  'hospital',
  'pharmacy',
  'taiwanOffice',
  'bank',
  'atm',
  'station',
  'water',
  'toilets',
  'library',
]);

/** Names a Taiwan (ROC) representative office is mapped under. */
const TAIWAN_OFFICE_NAME =
  /taipei|taiwan|ta[ií]w[aá]n|台北|臺北|台灣|臺灣|台湾|中華民國/i;

/**
 * Which travel category an OpenMapTiles `poi` feature is, or null.
 * @param {object} properties `class`, `subclass` and the name fields.
 */
export function travelPoiCategory(properties = {}) {
  const { class: kind, subclass } = properties;
  if (kind === 'police') return 'police';
  if (kind === 'hospital') return subclass === 'hospital' ? 'hospital' : null;
  if (kind === 'pharmacy') return 'pharmacy';
  if (kind === 'bank') return 'bank';
  if (kind === 'atm') return 'atm';
  if (kind === 'drinking_water') return 'water';
  if (kind === 'toilets') return 'toilets';
  if (kind === 'library') return subclass === 'library' ? 'library' : null;
  if (kind === 'ferry_terminal') return 'station';
  if (kind === 'railway') return subclass === 'station' ? 'station' : null;
  if (kind === 'bus') return subclass === 'bus_station' ? 'station' : null;
  if (kind === 'office' && subclass === 'diplomatic')
    return ['name', 'name:en', 'name:zh', 'name_int'].some((key) =>
      TAIWAN_OFFICE_NAME.test(String(properties[key] || '')),
    )
      ? 'taiwanOffice'
      : null;
  return null;
}

const valid = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180 &&
  // 0,0 is what a broken link carries, not where a traveller stands.
  !(lat === 0 && lon === 0);

const point = (lat, lon) =>
  valid(lat, lon) ? { lat: Number(lat), lon: Number(lon) } : null;

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const SEP = '(?:,|%2C)\\s*\\+?';

/** URL shapes that carry a position, most exact first. */
const URL_PATTERNS = [
  // Google Maps place data: the pin itself, not the map's centre.
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(
    `[?&](?:q|query|ll|sll|center|destination|daddr|saddr|coordinate|loc|cbll)=(?:loc:)?${NUM}${SEP}${NUM}`,
    'i',
  ),
  new RegExp(`/(?:search|place|dir)/${NUM}${SEP}${NUM}`),
  new RegExp(`/@${NUM},${NUM}`),
  // OpenStreetMap: ?mlat=&mlon= and #map=zoom/lat/lon.
  new RegExp(`[?&]mlat=${NUM}&mlon=${NUM}`),
  new RegExp(`#map=\\d+(?:\\.\\d+)?/${NUM}/${NUM}`),
  new RegExp(`^geo:${NUM},${NUM}`, 'i'),
];

/** Links that only redirect: the server has to follow them. */
const SHORT_LINK =
  /https?:\/\/(?:maps\.app\.goo\.gl\/[\w-]+|goo\.gl\/maps\/[\w-]+)[^\s]*/i;

function parseDms(text) {
  const part = `(\\d{1,3})\\s*[°º]\\s*(\\d{1,2})\\s*['′]\\s*(\\d{1,2}(?:\\.\\d+)?)\\s*["″]?\\s*([NSEW])`;
  const match = new RegExp(`${part}[\\s,]+${part}`, 'i').exec(text);
  if (!match) return null;
  const value = (d, m, s, hemi) =>
    (Number(d) + Number(m) / 60 + Number(s) / 3600) *
    (/[SW]/i.test(hemi) ? -1 : 1);
  const first = value(match[1], match[2], match[3], match[4]);
  const second = value(match[5], match[6], match[7], match[8]);
  return /[NS]/i.test(match[4]) ? point(first, second) : point(second, first);
}

/**
 * Read a position out of what a traveller sent: a Google/Apple/OpenStreetMap
 * link, a `geo:` URI, "25.0478, 121.5319", or degrees-minutes-seconds.
 * @param {string} input
 * @returns {{lat: number, lon: number}|{shortLink: string}|null} A position,
 *   a short link the server must follow first, or null.
 */
export function parseLocationText(input) {
  // A typographic minus is what phones put before a southern latitude.
  const raw = String(input || '')
    .replace(/[\u2212\u2013]/g, '-')
    .trim();
  if (!raw || raw.length > 4000) return null;
  const short = SHORT_LINK.exec(raw);
  if (short) return { shortLink: short[0] };
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // A stray % sign: read the text as it is.
  }
  if (/^(?:https?:|geo:)/i.test(text) || text.includes('://')) {
    for (const pattern of URL_PATTERNS) {
      const match = pattern.exec(text) || pattern.exec(raw);
      const found = match && point(Number(match[1]), Number(match[2]));
      if (found) return found;
    }
    return null;
  }
  const dms = parseDms(text);
  if (dms) return dms;
  const pair = new RegExp(
    `^\\(?\\s*${NUM}\\s*[,，\\s]\\s*${NUM}\\s*\\)?$`,
  ).exec(text);
  if (!pair) return null;
  const a = Number(pair[1]);
  const b = Number(pair[2]);
  // Latitude first, unless only the other order is a place on Earth.
  return point(a, b) || point(b, a);
}

/** Ground distance in metres (equirectangular; fine within a city). */
export function distanceM(a, b) {
  const toRad = Math.PI / 180;
  const x = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.hypot(x, y) * 6_371_000;
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** Compass arrow from `a` towards `b`, north up. */
export function directionArrow(a, b) {
  const toRad = Math.PI / 180;
  const east = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const north = b.lat - a.lat;
  const bearing = (Math.atan2(east, north) / toRad + 360) % 360;
  return ARROWS[Math.round(bearing / 45) % 8];
}

/**
 * Walking minutes for a straight-line distance: streets add about a third,
 * at 80 m a minute. An estimate to speak aloud, not a routed time.
 */
export function walkMinutes(metres) {
  return Math.max(1, Math.ceil((metres * 1.3) / 80));
}

/** "350 m" or "1.2 km". Digits and SI units read the same in every locale. */
export function distanceText(metres) {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/**
 * The nearest few places of each category, nearest first.
 * @param {Iterable<{id: string, category: string, lat: number, lon: number}>} pois
 * @param {{lat: number, lon: number}} origin
 * @param {number} [perCategory]
 * @returns {Record<string, object[]>} Category → places with `distanceM`.
 */
export function nearestByCategory(pois, origin, perCategory = 3) {
  const groups = Object.fromEntries(
    TRAVEL_CATEGORIES.map((category) => [category, []]),
  );
  const seen = new Set();
  for (const poi of pois) {
    if (!groups[poi.category] || seen.has(poi.id)) continue;
    seen.add(poi.id);
    groups[poi.category].push({ ...poi, distanceM: distanceM(origin, poi) });
  }
  for (const category of TRAVEL_CATEGORIES)
    groups[category] = groups[category]
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, perCategory);
  return groups;
}

/** One zone per country, for the countries with one civil time. */
const COUNTRY_ZONES = {
  TW: 'Asia/Taipei',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  NZ: 'Pacific/Auckland',
  GB: 'Europe/London',
  FR: 'Europe/Paris',
  DE: 'Europe/Berlin',
  IT: 'Europe/Rome',
  ES: 'Europe/Madrid',
  NL: 'Europe/Amsterdam',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  CZ: 'Europe/Prague',
  BE: 'Europe/Brussels',
  SE: 'Europe/Stockholm',
  TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh',
  SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur',
  PH: 'Asia/Manila',
  HK: 'Asia/Hong_Kong',
  MO: 'Asia/Macau',
  CN: 'Asia/Shanghai',
  TR: 'Europe/Istanbul',
  AE: 'Asia/Dubai',
};

/** Countries with several zones: first-level division → zone. */
const DIVISION_ZONES = {
  AU: {
    Queensland: 'Australia/Brisbane',
    'New South Wales': 'Australia/Sydney',
    'Australian Capital Territory': 'Australia/Sydney',
    Victoria: 'Australia/Melbourne',
    Tasmania: 'Australia/Hobart',
    'South Australia': 'Australia/Adelaide',
    'Northern Territory': 'Australia/Darwin',
    'Western Australia': 'Australia/Perth',
  },
  ID: {
    Bali: 'Asia/Makassar',
    Jakarta: 'Asia/Jakarta',
    'Jakarta Raya': 'Asia/Jakarta',
  },
};

/**
 * The time zone of a place, from its country and first-level division, or
 * null when this table cannot tell (a country with several zones and an
 * unlisted division): the zone is then chosen by hand.
 * @param {?string} countryCode ISO 3166-1 alpha-2.
 * @param {?string} [division] First-level division name, in English.
 * @returns {?string} IANA zone id.
 */
export function zoneForPlace(countryCode, division) {
  if (!countryCode) return null;
  const byDivision = DIVISION_ZONES[countryCode];
  if (byDivision) return (division && byDivision[division]) || null;
  return COUNTRY_ZONES[countryCode] || null;
}

/** "Australia/Brisbane" → "Brisbane"; the city is what people say. */
export function zoneCity(zone) {
  return String(zone || '')
    .split('/')
    .pop()
    .replace(/_/g, ' ');
}

/**
 * A zone's clock at an instant, without a formatting locale: `{time: "14:05",
 * date: "2026-11-15", offsetMinutes: 600, night: false}`, or null for an
 * unknown zone.
 */
export function zoneClock(zone, at = Date.now()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(at));
  } catch {
    return null;
  }
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(get('hour'));
  const local = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    hour,
    Number(get('minute')),
  );
  return {
    time: `${get('hour')}:${get('minute')}`,
    date: `${get('year')}-${get('month')}-${get('day')}`,
    offsetMinutes: Math.round(
      (local - Math.floor(at / 60_000) * 60_000) / 60_000,
    ),
    night: hour < 6 || hour >= 19,
  };
}

/** "+2 h", "−1.5 h" or "±0 h": how far a zone runs ahead of another. */
export function offsetDifferenceText(minutes, referenceMinutes) {
  const hours = (minutes - referenceMinutes) / 60;
  if (hours === 0) return '±0 h';
  return `${hours > 0 ? '+' : '−'}${Math.abs(hours)} h`;
}
