// PL-471: THE class-level quiet predicate — one derived rule for every
// class-keyed sweep, alert, nudge, digest line, dashboard row, timecard and
// calendar write. PL-463 gated the instructor sends (instructor-comms.ts);
// PL-457 gated the family sends (the comms_muted enrollment flag inside
// sendOnce). Both audits missed the machinery that keys on the CLASS rather
// than an enrollment or an instructor object: the timecard sweep built (and
// announced) class-hours cards for records-only classes the moment real
// instructors were assigned, and the class-details HOLD alert told staff
// "families are waiting" about families the portal will never email.
//
// A class is QUIET when the portal is not the thing running its comms:
//   * cancelled                       — the cancellation emails already went out
//   * ended                           — its last session has passed
//   * records-only                    — every paid enrollment is a comms-muted
//                                       cutover import (the roster is here for
//                                       records; families, instructor and school
//                                       are handled outside the portal)
//   * running with no portal roster   — first session passed with zero paid
//                                       enrollments (a records-only class before
//                                       its import lands — the MIS placeholder case)
// Derived from state every time, never a column — the purge proved that
// once-per-class sends carry only a dedupe key, so a guard that is a memory
// re-fires the moment the send log is empty.
//
// TWO predicates, because "ended" is not "unpayable": a live portal-run
// class whose last session was yesterday still pays its instructor for the
// closing period. classQuietReason() is the comms/alerts/calendar rule;
// classPayableThroughPortal() is the timecard rule (cancelled and
// no-portal-roster classes are never payable through the portal — those
// instructors are paid outside it).

export type QuietEnrollment = { payment_status: string; commsMuted: boolean }

export type QuietInput = {
  status: string
  timezone: string
  /** Earliest / latest session date (YYYY-MM-DD); start_date when none. */
  firstSession: string | null
  lastSession: string | null
  enrollments: QuietEnrollment[]
}

function localDateIn(tz: string, d: Date = new Date()): string {
  try {
    return d.toLocaleDateString('en-CA', { timeZone: tz })
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

const paidRows = (cls: QuietInput) =>
  cls.enrollments.filter((e) => e.payment_status === 'Paid' || e.payment_status === 'Completed')

/** Why the portal must stay QUIET toward everyone attached to this class —
 *  null = a live, portal-run class. Same strings PL-463's instructor rule
 *  returned (that rule now delegates here). */
export function classQuietReason(cls: QuietInput, today: string = localDateIn(cls.timezone)): string | null {
  if (cls.status === 'cancelled') return 'class cancelled'
  if (cls.lastSession && today > cls.lastSession) return 'class ended (last session has passed)'
  const paid = paidRows(cls)
  if (paid.length > 0 && paid.every((e) => e.commsMuted))
    return 'records-only class (every paid enrollment is a comms-muted import)'
  if (paid.length === 0 && cls.firstSession && today >= cls.firstSession)
    return 'class already running with no portal enrollments (a records-only class before its import lands)'
  return null
}

/** True when the class's roster is NOT in the portal's hands — records-only
 *  or running with no portal enrollments. Ended/live portal-run classes are
 *  false (they were run here). */
export function classRosterOutsidePortal(cls: QuietInput, today: string = localDateIn(cls.timezone)): boolean {
  if (cls.status === 'cancelled') return false
  const paid = paidRows(cls)
  if (paid.length > 0) return paid.every((e) => e.commsMuted)
  return Boolean(cls.firstSession && today >= cls.firstSession)
}

/** The timecard rule: class hours are payable through the portal only for a
 *  non-cancelled class the portal actually ran (ended classes INCLUDED —
 *  the closing pay period still pays). Records-only / no-roster classes
 *  pay their instructors outside the portal, so no card and no T5. */
export function classPayableThroughPortal(cls: QuietInput, today: string = localDateIn(cls.timezone)): boolean {
  if (cls.status === 'cancelled') return false
  return !classRosterOutsidePortal(cls, today)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

/** Adapt a raw `classes` select (with `sessions ( session_date )`,
 *  `enrollments ( payment_status, comms_muted )`, `schools ( timezone )`)
 *  to the predicate's input. Every raw-row sweep goes through this so the
 *  rule has ONE shape. */
export function quietInputFromRow(row: any): QuietInput {
  const days = ((row.sessions ?? []) as any[]).map((s) => s.session_date).filter(Boolean).sort()
  return {
    status: row.status,
    timezone: row.timezone ?? one<any>(row.schools)?.timezone ?? 'America/Denver',
    firstSession: days[0] ?? row.start_date ?? null,
    lastSession: days[days.length - 1] ?? row.start_date ?? null,
    enrollments: ((row.enrollments ?? []) as any[]).map((e) => ({
      payment_status: e.payment_status,
      commsMuted: e.comms_muted === true || e.commsMuted === true,
    })),
  }
}

/** The select fragment a raw-row caller must include for quietInputFromRow. */
export const QUIET_SELECT = 'status, timezone, start_date, schools ( timezone ), sessions ( session_date ), enrollments ( payment_status, comms_muted )'

/** Class ids whose hours are NOT payable through the portal (records-only /
 *  no-roster / cancelled) — the timecard sweep subtracts these. */
export async function classIdsNotPayableThroughPortal(
  supabase: { from: (t: string) => any }
): Promise<Set<string>> {
  const { data } = await supabase
    .from('classes')
    .select(`id, ${QUIET_SELECT}`)
    .neq('status', 'draft')
  const out = new Set<string>()
  for (const row of (data as any[]) ?? []) {
    if (!classPayableThroughPortal(quietInputFromRow(row))) out.add(row.id)
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */
