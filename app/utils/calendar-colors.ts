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
