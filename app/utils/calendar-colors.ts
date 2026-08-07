// PL-160/PL-161: Kelsie's established calendar color language, kept EXACTLY
// so nobody retrains — yellow = proposed/not confirmed · dark green =
// confirmed in-person · light green = confirmed online · red = cancelled
// (cancelled renders red; it does not disappear). Hexes are the Google
// Calendar palette entries the hand-managed calendar used.
//
// LEAF on purpose: the admin calendar view (client) and the International
// Classes calendar writer (server) both color through this one map.

export type CalendarStatus = 'proposed' | 'confirmed_in_person' | 'confirmed_online' | 'cancelled'

export const CALENDAR_COLORS: Record<CalendarStatus, { bg: string; text: string; label: string }> = {
  proposed: { bg: '#F6BF26', text: '#3F2E00', label: 'Proposed — not confirmed' },
  confirmed_in_person: { bg: '#0B8043', text: '#FFFFFF', label: 'Confirmed · in person' },
  confirmed_online: { bg: '#7CB342', text: '#1E3308', label: 'Confirmed · online' },
  cancelled: { bg: '#D50000', text: '#FFFFFF', label: 'Cancelled' },
}

/** Google Calendar colorId for each status (the palette Kelsie used by hand):
 *  5 = Banana, 10 = Basil, 2 = Sage, 11 = Tomato. */
export const GCAL_COLOR_IDS: Record<CalendarStatus, string> = {
  proposed: '5',
  confirmed_in_person: '10',
  confirmed_online: '2',
  cancelled: '11',
}

// PL-283: the official Google Calendar calendar-list palette (24 colors, the
// swatches Kelsie picks tutor colors from in Google). Names + hexes are the
// Calendar API's own `colors` definitions — kept exact so a color chosen here
// matches the same swatch in her Google Calendar sidebar.
export const GOOGLE_CALENDAR_PALETTE: { name: string; hex: string }[] = [
  { name: 'Cocoa', hex: '#795548' },
  { name: 'Flamingo', hex: '#E67C73' },
  { name: 'Tomato', hex: '#D50000' },
  { name: 'Tangerine', hex: '#F4511E' },
  { name: 'Pumpkin', hex: '#EF6C00' },
  { name: 'Mango', hex: '#F09300' },
  { name: 'Eucalyptus', hex: '#009688' },
  { name: 'Basil', hex: '#0B8043' },
  { name: 'Pistachio', hex: '#7CB342' },
  { name: 'Avocado', hex: '#C0CA33' },
  { name: 'Citron', hex: '#E4C441' },
  { name: 'Banana', hex: '#F6BF26' },
  { name: 'Sage', hex: '#33B679' },
  { name: 'Peacock', hex: '#039BE5' },
  { name: 'Cobalt', hex: '#4285F4' },
  { name: 'Blueberry', hex: '#3F51B5' },
  { name: 'Lavender', hex: '#7986CB' },
  { name: 'Wisteria', hex: '#B39DDB' },
  { name: 'Graphite', hex: '#616161' },
  { name: 'Birch', hex: '#A79B8E' },
  { name: 'Radicchio', hex: '#AD1457' },
  { name: 'Cherry Blossom', hex: '#D81B60' },
  { name: 'Grape', hex: '#8E24AA' },
  { name: 'Amethyst', hex: '#9E69AF' },
]

/** PL-283: readable text color for an arbitrary background — the PL-271
 *  usableAccent lesson generalized: never paint text a color the background
 *  swallows. BT.601 luma; the 150 threshold reproduces the hand-picked
 *  pairings in CALENDAR_COLORS above (white on Basil, dark on Pistachio). */
export function textOnColor(bgHex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bgHex.trim())
  if (!m) return '#1F2937'
  const n = parseInt(m[1], 16)
  const luma = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)
  return luma >= 150 ? '#1F2937' : '#FFFFFF'
}

/** PL-283: stable auto-color for a tutor with no assigned color — a
 *  deterministic hash of the tutor id into the palette colors nobody has
 *  claimed (same tutor + same claimed set → same color, never random per
 *  render). Falls back to the whole palette if every color is claimed. */
export function autoTutorColor(tutorId: string, takenHexes: Iterable<string>): string {
  const taken = new Set(Array.from(takenHexes, (h) => h.toUpperCase()))
  const pool = GOOGLE_CALENDAR_PALETTE.filter((p) => !taken.has(p.hex.toUpperCase()))
  const candidates = pool.length > 0 ? pool : GOOGLE_CALENDAR_PALETTE
  let hash = 0
  for (let i = 0; i < tutorId.length; i++) hash = (hash * 31 + tutorId.charCodeAt(i)) >>> 0
  return candidates[hash % candidates.length].hex
}

/** An online location is a link; anything else is a place. */
export function isOnlineLocation(location: string | null | undefined): boolean {
  return Boolean(location && /^https?:\/\/|zoom\.us|meet\.google|teams\.microsoft/i.test(location))
}

export function statusFor(opts: {
  /** Session/class status from the portal. */
  status: string
  /** 'online' | 'in_person' when known (classes); else derived from location. */
  deliveryMode?: string | null
  location?: string | null
}): CalendarStatus {
  if (opts.status === 'cancelled') return 'cancelled'
  if (opts.status === 'proposed') return 'proposed'
  const online = opts.deliveryMode ? opts.deliveryMode === 'online' : isOnlineLocation(opts.location)
  return online ? 'confirmed_online' : 'confirmed_in_person'
}
