// PL-279 — LEAF MODULE (client-importable; no server-only imports, ever —
// regress:client-imports walks from 'use client' roots). The PURE half of
// the FO follow-on campaign: cohort-window math and formatting, shared by
// the server engine (follow-on.ts), the extend API, and the admin roster
// card, so the window can never be computed two ways.

export const FO_WINDOW_DAYS = 14
export const FO_REMINDER_BEFORE_DAYS = 2
export const FO_EXTENSION_DAYS = 7
export const FO_SEND_HOUR = 9

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

export type CohortWindow = {
  /** Stage-1 send date: the day after the feeder's last session. */
  announceDate: string
  /** The cohort's original discount deadline (last session + window). */
  baseDeadline: string
  /** Stage-2 send date (base deadline − 2 days). */
  reminderDate: string
  /** The EFFECTIVE deadline — extension wins when set and later. */
  deadline: string
  extended: boolean
}

/** The cohort's rolling window, from the FEEDER's own schedule. */
export function cohortWindow(feeder: {
  lastSession: string
  foExtendedUntil: string | null
}): CohortWindow {
  const announceDate = addDaysIso(feeder.lastSession, 1)
  const baseDeadline = addDaysIso(feeder.lastSession, FO_WINDOW_DAYS)
  const reminderDate = addDaysIso(baseDeadline, -FO_REMINDER_BEFORE_DAYS)
  const extended = Boolean(feeder.foExtendedUntil && feeder.foExtendedUntil > baseDeadline)
  return {
    announceDate,
    baseDeadline,
    reminderDate,
    deadline: extended ? feeder.foExtendedUntil! : baseDeadline,
    extended,
  }
}

/** The extend action's target date: a week past the current effective
 *  deadline, or a week from today if the window is already long gone (a
 *  freshly-extended cohort must always get a real future window). */
export function extensionTarget(window: CohortWindow, todayIso: string): string {
  const from = window.deadline > todayIso ? window.deadline : todayIso
  return addDaysIso(from, FO_EXTENSION_DAYS)
}
