// PL-506 (Scarlett, Sep 24): the homepage strip's state pick + orderings —
// ONE pure module the embed route and regress:embed-order both run.
//
// State ("Upcoming" = registration open; "Current" = in progress; "Recent"
// = ended; cancelled never appears — the PL-501 classGroup() rule, no new
// state logic):
//   ≥2 upcoming            → "Upcoming Classes"               (upcoming only)
//   1 upcoming, ≥1 current → "Upcoming and Current Classes"   (the 1, then current)
//   1 upcoming, 0 current  → "Upcoming and Recent Classes"    (the 1, then recent)
//   0 upcoming, ≥1 current → "Classes Happening Now"          (current)
//   0, 0                   → "Recent Classes"                 (recent)
// Upcoming order: priority schools (Scarlett's ordered list) → soonest start
// → fewest paid → newest school (fewest classes ever run). Current/recent
// order: priority schools → most recent start → fewest classes ever run.
// Caps: 4 (3 for the current/recent rows that follow one upcoming class).
// Sizes: 2–3 upcoming alone → large cards; otherwise normal tiles.

import { classGroup, type ClassGroupKey, type GroupableClass } from './class-groups'

export type EmbedClass = GroupableClass & {
  school_id: string | null
  /** paid enrollments (Paid / Completed) */
  paidCount: number
  /** classes ever run at the school (non-cancelled), 0 for a school-less class */
  schoolClassCount: number
}

export type EmbedHeadline =
  | 'Upcoming Classes'
  | 'Upcoming and Current Classes'
  | 'Upcoming and Recent Classes'
  | 'Classes Happening Now'
  | 'Recent Classes'

export type EmbedPlan<T extends EmbedClass> = {
  headline: EmbedHeadline
  /** 'large' = 2–3 upcoming alone; 'tiles' otherwise; 'empty' = nothing in the database at all */
  mode: 'large' | 'tiles' | 'empty'
  upcoming: T[]
  others: T[]
  othersKind: 'current' | 'recent' | null
}

const priorityRank = (c: EmbedClass, priority: string[]) => {
  const i = c.school_id ? priority.indexOf(c.school_id) : -1
  return i < 0 ? priority.length : i
}
const start = (c: EmbedClass) => {
  const days = (c.sessions ?? []).map((s) => s.session_date).filter(Boolean).sort()
  return days[0] ?? c.start_date ?? ''
}

export function orderUpcoming<T extends EmbedClass>(rows: T[], priority: string[]): T[] {
  return [...rows].sort(
    (a, b) =>
      priorityRank(a, priority) - priorityRank(b, priority) ||
      start(a).localeCompare(start(b)) ||
      a.paidCount - b.paidCount ||
      a.schoolClassCount - b.schoolClassCount
  )
}

export function orderCurrentOrRecent<T extends EmbedClass>(rows: T[], priority: string[]): T[] {
  return [...rows].sort(
    (a, b) =>
      priorityRank(a, priority) - priorityRank(b, priority) ||
      start(b).localeCompare(start(a)) ||
      a.schoolClassCount - b.schoolClassCount
  )
}

export function planEmbed<T extends EmbedClass>(rows: T[], opts: { today: string; priority: string[]; groupOf?: (c: T) => ClassGroupKey }): EmbedPlan<T> {
  const groupOf = opts.groupOf ?? ((c: T) => classGroup(c, opts.today))
  const upcoming = orderUpcoming(rows.filter((c) => groupOf(c) === 'open'), opts.priority)
  const current = orderCurrentOrRecent(rows.filter((c) => groupOf(c) === 'in-progress'), opts.priority)
  const recent = orderCurrentOrRecent(rows.filter((c) => groupOf(c) === 'ended'), opts.priority)
  if (upcoming.length >= 2) {
    const picked = upcoming.slice(0, 4)
    return { headline: 'Upcoming Classes', mode: picked.length <= 3 ? 'large' : 'tiles', upcoming: picked, others: [], othersKind: null }
  }
  if (upcoming.length === 1) {
    const others = current.length > 0 ? current : recent
    return {
      headline: current.length > 0 ? 'Upcoming and Current Classes' : 'Upcoming and Recent Classes',
      mode: 'tiles',
      upcoming,
      others: others.slice(0, 3),
      othersKind: current.length > 0 ? 'current' : 'recent',
    }
  }
  if (current.length > 0) return { headline: 'Classes Happening Now', mode: 'tiles', upcoming: [], others: current.slice(0, 4), othersKind: 'current' }
  return { headline: 'Recent Classes', mode: recent.length > 0 ? 'tiles' : 'empty', upcoming: [], others: recent.slice(0, 4), othersKind: 'recent' }
}
