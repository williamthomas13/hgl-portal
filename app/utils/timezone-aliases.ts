// PL-238: the timezone picker must be findable by COUNTRY and MAJOR CITY,
// not just the IANA zone name — Scarlett couldn't reach Europe/Rome by
// typing "Italy" or "Milan". A maintained alias map is enough (no geocoder):
// country → its primary zone(s), top non-IANA cities → their zone. Searching
// matches these as keywords; the visible label stays the IANA zone plus its
// CURRENT UTC offset so the choice is verifiable at a glance.
//
// Leaf module — no imports, safe for client and server bundles.

/** zone → search keywords (countries, cities, spellings). */
export const TZ_ALIASES: Record<string, string[]> = {
  // Americas
  'America/New_York': ['usa', 'united states', 'eastern', 'nyc', 'boston', 'miami', 'atlanta', 'washington'],
  'America/Chicago': ['usa', 'united states', 'central', 'houston', 'dallas', 'austin', 'minneapolis'],
  'America/Denver': ['usa', 'united states', 'mountain', 'salt lake city', 'utah', 'boulder', 'albuquerque', 'santa fe', 'new mexico'],
  'America/Phoenix': ['usa', 'united states', 'arizona'],
  'America/Los_Angeles': ['usa', 'united states', 'pacific', 'san francisco', 'seattle', 'portland', 'california', 'san diego'],
  'America/Anchorage': ['usa', 'united states', 'alaska'],
  'Pacific/Honolulu': ['usa', 'united states', 'hawaii'],
  'America/Toronto': ['canada', 'ontario', 'ottawa'],
  'America/Vancouver': ['canada', 'british columbia'],
  'America/Mexico_City': ['mexico', 'cdmx', 'guadalajara'],
  'America/Monterrey': ['mexico'],
  'America/Cancun': ['mexico'],
  'America/Guatemala': ['guatemala'],
  'America/Costa_Rica': ['costa rica', 'san jose'],
  'America/Panama': ['panama'],
  'America/Bogota': ['colombia', 'medellin'],
  'America/Lima': ['peru'],
  'America/Guayaquil': ['ecuador', 'quito'],
  'America/Caracas': ['venezuela'],
  'America/La_Paz': ['bolivia'],
  'America/Santiago': ['chile'],
  'America/Argentina/Buenos_Aires': ['argentina'],
  'America/Montevideo': ['uruguay'],
  'America/Asuncion': ['paraguay'],
  'America/Sao_Paulo': ['brazil', 'brasil', 'rio de janeiro', 'rio'],
  'America/Santo_Domingo': ['dominican republic'],
  'America/Port-au-Prince': ['haiti'],
  'America/Havana': ['cuba'],
  'America/Jamaica': ['jamaica', 'kingston'],
  'America/Nassau': ['bahamas'],
  // Europe
  'Europe/London': ['uk', 'united kingdom', 'england', 'britain', 'scotland', 'wales', 'manchester', 'edinburgh'],
  'Europe/Dublin': ['ireland'],
  'Europe/Lisbon': ['portugal', 'porto'],
  'Europe/Madrid': ['spain', 'barcelona', 'valencia', 'seville', 'espana'],
  'Europe/Paris': ['france', 'lyon', 'marseille', 'nice'],
  'Europe/Brussels': ['belgium', 'antwerp'],
  'Europe/Amsterdam': ['netherlands', 'holland', 'rotterdam', 'the hague'],
  'Europe/Berlin': ['germany', 'munich', 'frankfurt', 'hamburg', 'cologne', 'deutschland'],
  'Europe/Zurich': ['switzerland', 'geneva', 'basel', 'bern'],
  'Europe/Rome': ['italy', 'milan', 'turin', 'florence', 'naples', 'venice', 'italia'],
  'Europe/Vienna': ['austria', 'salzburg'],
  'Europe/Prague': ['czech republic', 'czechia'],
  'Europe/Warsaw': ['poland', 'krakow'],
  'Europe/Budapest': ['hungary'],
  'Europe/Copenhagen': ['denmark'],
  'Europe/Stockholm': ['sweden', 'gothenburg'],
  'Europe/Oslo': ['norway'],
  'Europe/Helsinki': ['finland'],
  'Europe/Athens': ['greece', 'thessaloniki'],
  'Europe/Bucharest': ['romania'],
  'Europe/Sofia': ['bulgaria'],
  'Europe/Belgrade': ['serbia'],
  'Europe/Zagreb': ['croatia'],
  'Europe/Kyiv': ['ukraine', 'kiev'],
  'Europe/Istanbul': ['turkey', 'turkiye', 'ankara'],
  'Europe/Moscow': ['russia', 'st petersburg'],
  // Africa & Middle East
  'Africa/Casablanca': ['morocco', 'rabat', 'marrakesh'],
  'Africa/Algiers': ['algeria'],
  'Africa/Tunis': ['tunisia'],
  'Africa/Cairo': ['egypt', 'alexandria'],
  'Africa/Lagos': ['nigeria', 'abuja'],
  'Africa/Accra': ['ghana'],
  'Africa/Nairobi': ['kenya'],
  'Africa/Addis_Ababa': ['ethiopia'],
  'Africa/Johannesburg': ['south africa', 'cape town', 'pretoria', 'durban'],
  'Asia/Jerusalem': ['israel', 'tel aviv'],
  'Asia/Beirut': ['lebanon'],
  'Asia/Amman': ['jordan'],
  'Asia/Riyadh': ['saudi arabia', 'jeddah'],
  'Asia/Dubai': ['uae', 'united arab emirates', 'abu dhabi'],
  'Asia/Qatar': ['qatar', 'doha'],
  'Asia/Kuwait': ['kuwait'],
  'Asia/Baghdad': ['iraq'],
  'Asia/Tehran': ['iran'],
  // Asia-Pacific
  'Asia/Karachi': ['pakistan', 'lahore', 'islamabad'],
  'Asia/Kolkata': ['india', 'delhi', 'mumbai', 'bangalore', 'bengaluru', 'chennai', 'hyderabad', 'calcutta'],
  'Asia/Dhaka': ['bangladesh'],
  'Asia/Colombo': ['sri lanka'],
  'Asia/Kathmandu': ['nepal'],
  'Asia/Bangkok': ['thailand', 'vietnam', 'hanoi', 'ho chi minh', 'saigon'],
  'Asia/Jakarta': ['indonesia'],
  'Asia/Kuala_Lumpur': ['malaysia'],
  'Asia/Singapore': ['singapore'],
  'Asia/Manila': ['philippines'],
  'Asia/Hong_Kong': ['hong kong'],
  'Asia/Taipei': ['taiwan'],
  'Asia/Shanghai': ['china', 'beijing', 'shenzhen', 'guangzhou', 'chengdu', 'peking'],
  'Asia/Seoul': ['south korea', 'korea', 'busan'],
  'Asia/Tokyo': ['japan', 'osaka', 'kyoto', 'yokohama'],
  'Australia/Sydney': ['australia', 'canberra', 'new south wales'],
  'Australia/Melbourne': ['australia', 'victoria'],
  'Australia/Brisbane': ['australia', 'queensland'],
  'Australia/Perth': ['australia', 'western australia'],
  'Pacific/Auckland': ['new zealand', 'wellington'],
}

export function tzKeywords(tz: string): string {
  return (TZ_ALIASES[tz] ?? []).join(' ')
}

/** Current UTC offset for a zone, e.g. "UTC+2" / "UTC-6:30" — makes the
 *  picked zone verifiable at a glance. Empty string if the zone is unknown
 *  to this runtime. */
export function utcOffsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    // "GMT+2" / "GMT-6:30" / "GMT" → UTC form
    if (!name) return ''
    return name === 'GMT' ? 'UTC+0' : name.replace(/^GMT/, 'UTC')
  } catch {
    return ''
  }
}
