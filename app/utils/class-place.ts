// PL-468: THE one rule for where an in-person class happens. Two facts:
//   venue — known at sign-up ("ASF campus"; null = composed from the school)
//   room  — confirmed later by the school (classes.default_location)
// Client-safe (no imports) — the public page, register page, portal cards,
// emails and collateral all word it through here.

export type ClassPlaceInput = {
  venue?: string | null
  /** classes.default_location — the ROOM for in-person, the meeting link online. */
  room?: string | null
  deliveryMode?: string | null
  schoolName?: string | null
}

/** The venue line: the stored one, else "On campus at {school}" for an
 *  in-person school class, else null (open classes at HGL name their room). */
export function classVenue(i: ClassPlaceInput): string | null {
  const v = i.venue?.trim()
  if (v) return v
  if (i.deliveryMode !== 'online' && i.schoolName?.trim()) return `On campus at ${i.schoolName.trim()}`
  return null
}

/** Families' line. Room known → "{venue} · {room}"; not yet → "{venue} — classroom
 *  to be confirmed"; no venue → the room alone (or null); online → the link. */
export function classPlaceLine(i: ClassPlaceInput): string | null {
  const room = i.room?.trim() || null
  if (i.deliveryMode === 'online') return room
  const venue = classVenue(i)
  if (!venue) return room
  return room ? `${venue} · ${room}` : `${venue} — classroom to be confirmed`
}

/** True when the line still promises a room to come. */
export function classRoomPending(i: ClassPlaceInput): boolean {
  return i.deliveryMode !== 'online' && !i.room?.trim() && Boolean(classVenue(i))
}
