// PL-279/PL-295 — LEAF MODULE (client-importable; no server-only imports,
// ever — regress:client-imports walks from 'use client' roots). The PURE
// half of the FO follow-on campaign: cohort-window math and formatting,
// shared by the server engine (follow-on.ts), the extend API, and the admin
// roster card, so the window can never be computed two ways.
//
// PL-295 window shape (supersedes the original +1/+14 constants):
//   announce     = last session + 2  (PL-295A: the E-series review request
//                  fires at last+1 8am and the tutoring offer at +4 — +2
//                  lands the FO pitch the day after the review ask, clear of
//                  both, while the post-class momentum is fresh)
//   discount end = announce + 7      (PL-295B: a genuinely short window),
//                  ALWAYS clamped to the follow-on class's stated
//                  registration deadline — registration itself stays open at
//                  full price until that deadline; only the discount ends
//   reminder     = discount end − 2  (skipped when it collides w/ announce)
//   extension    = +7 on the deliberate extend action (or the PL-294
//                  auto-extend switch); the sweep NUDGES the admin the day
//                  after a window closes un-extended (PL-295B)
// PL-295C: per-feeder overrides (announce date — may predate the last
// session for an early start; discount end; exclude flag) ride the same
// math as inputs, so sweep, checkout seam, and roster card always agree.

export const FO_ANNOUNCE_OFFSET_DAYS = 2
export const FO_DISCOUNT_DAYS = 7
export const FO_REMINDER_BEFORE_DAYS = 2
export const FO_EXTENSION_DAYS = 7
export const FO_SEND_HOUR = 9
/** The nudge stays visible this many days after the window closes (sweep
 *  resilience), still deduped to once per cohort per window. */
export const FO_NUDGE_GRACE_DAYS = 2

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "Friday, September 25, 2026" — the emails' {endDate}. */
export function foLongDate(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export type CohortInputs = {
  lastSession: string
  foExtendedUntil: string | null
  /** PL-295C: manual announce date (early start allowed). */
  foAnnounceDate?: string | null
  /** PL-295C: manual discount end. */
  foDiscountEnd?: string | null
  /** PL-295B: the follow-on class's stated registration deadline — the
   *  discount end (computed OR manual) never outlives it. */
  targetRegistrationDeadline?: string | null
}

export type CohortWindow = {
  /** Stage-1 send date. */
  announceDate: string
  /** The cohort's discount end (pre-extension). Kept under its historical
   *  name — every consumer reads baseDeadline. */
  baseDeadline: string
  /** Stage-2 send date (discount end − 2); may equal announceDate on very
   *  tight windows — consumers skip the reminder then. */
  reminderDate: string
  /** The EFFECTIVE discount deadline — extension wins when set and later. */
  deadline: string
  extended: boolean
  /** Which inputs were overridden (the roster card labels them). */
  announceOverridden: boolean
  discountEndOverridden: boolean
  clampedToRegistrationDeadline: boolean
}

/** The cohort's rolling window, from the FEEDER's own schedule + overrides. */
export function cohortWindow(feeder: CohortInputs): CohortWindow {
  const announceDate = feeder.foAnnounceDate ?? addDaysIso(feeder.lastSession, FO_ANNOUNCE_OFFSET_DAYS)
  let baseDeadline = feeder.foDiscountEnd ?? addDaysIso(announceDate, FO_DISCOUNT_DAYS)
  let clamped = false
  if (feeder.targetRegistrationDeadline && baseDeadline > feeder.targetRegistrationDeadline) {
    baseDeadline = feeder.targetRegistrationDeadline
    clamped = true
  }
  // A window can never end before it opens (odd override/clamp combos).
  if (baseDeadline < announceDate) baseDeadline = announceDate
  const reminderDate = addDaysIso(baseDeadline, -FO_REMINDER_BEFORE_DAYS)
  const extended = Boolean(feeder.foExtendedUntil && feeder.foExtendedUntil > baseDeadline)
  return {
    announceDate,
    baseDeadline,
    reminderDate,
    deadline: extended ? feeder.foExtendedUntil! : baseDeadline,
    extended,
    announceOverridden: Boolean(feeder.foAnnounceDate),
    discountEndOverridden: Boolean(feeder.foDiscountEnd),
    clampedToRegistrationDeadline: clamped,
  }
}

/** The extend action's target date: a week past the current effective
 *  deadline, or a week from today if the window is already long gone (a
 *  freshly-extended cohort must always get a real future window). */
export function extensionTarget(window: CohortWindow, todayIso: string): string {
  const from = window.deadline > todayIso ? window.deadline : todayIso
  return addDaysIso(from, FO_EXTENSION_DAYS)
}
