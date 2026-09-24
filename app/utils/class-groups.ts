// PL-501 (Scarlett, Sep 24): the admin Classes list is findable at 13+ past
// classes — grouped, searchable, sortable. PURE (no React, no DB) so the
// page and the regress gate run the very same rules on the same rows.
//
// Groups, in display order:
//   open        — status open, registration still open (close date ≥ today)
//   in-progress — sessions have started, last session still ahead
//   upcoming    — first session ahead but registration not open (closed
//                 early, or a status other than open)
//   ended       — last session (or start date, session-less) before today
//   cancelled   — status cancelled, whatever the dates (never under Ended)

export type ClassGroupKey = 'open' | 'in-progress' | 'upcoming' | 'ended' | 'cancelled'

export const CLASS_GROUPS: { key: ClassGroupKey; label: string; live: boolean }[] = [
  { key: 'open', label: 'Open for registration', live: true },
  { key: 'in-progress', label: 'In progress', live: true },
  { key: 'upcoming', label: 'Upcoming (no registration yet)', live: true },
  { key: 'ended', label: 'Ended', live: false },
  { key: 'cancelled', label: 'Cancelled', live: false },
]

export type GroupableClass = {
  id: string
  status: string
  slug: string | null
  class_type: string
  start_date: string | null
  registration_close_date: string | null
  sessions?: { session_date: string }[] | null
  schools?: { name?: string | null; nickname?: string | null; evergreen_code?: string | null } | null
  instructors?: { name?: string | null } | null
  course_key?: string | null
  fo_short_name?: string | null
  delivery_mode?: string | null
}

export function classDays(c: GroupableClass): { first: string | null; last: string | null } {
  const days = (c.sessions ?? []).map((s) => s.session_date).filter(Boolean).sort()
  return { first: days[0] ?? c.start_date ?? null, last: days[days.length - 1] ?? c.start_date ?? null }
}

export function classGroup(c: GroupableClass, today: string): ClassGroupKey {
  if (c.status === 'cancelled') return 'cancelled'
  const { first, last } = classDays(c)
  if (last && last < today) return 'ended'
  const close = c.registration_close_date ? String(c.registration_close_date).slice(0, 10) : null
  if (c.status === 'open' && (!close || close >= today)) return 'open'
  if (first && first <= today) return 'in-progress'
  return 'upcoming'
}

/** The term token — the last dash-segment of the slug ("sls-sat-prep-fall26" → "fall26"). */
export function classTerm(c: GroupableClass): string | null {
  const parts = (c.slug ?? '').split('-').filter(Boolean)
  const t = parts[parts.length - 1] ?? ''
  return /^(spring|summer|fall|winter|autumn)\d{2,4}$/i.test(t) ? t.toLowerCase() : null
}

/** Every string the search box matches against (lower-cased). */
export function classSearchText(c: GroupableClass): string {
  const instructorFirst = (c.instructors?.name ?? '').trim().split(/\s+/)[0] ?? ''
  return [
    c.schools?.nickname,
    c.schools?.name,
    c.schools?.evergreen_code,
    c.slug,
    c.class_type,
    c.fo_short_name,
    c.course_key,
    instructorFirst,
    classTerm(c),
    c.delivery_mode === 'online' ? 'online' : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Every whitespace-separated token must appear somewhere in the class's text. */
export function matchesSearch(c: GroupableClass, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = classSearchText(c)
  return tokens.every((t) => text.includes(t))
}

export type ClassSort = 'newest' | 'oldest' | 'school'

export function sortClasses<T extends GroupableClass>(rows: T[], sort: ClassSort): T[] {
  const first = (c: GroupableClass) => classDays(c).first ?? ''
  const school = (c: GroupableClass) => (c.schools?.nickname ?? c.schools?.name ?? (c.delivery_mode === 'online' ? 'Online' : 'HGL')).toLowerCase()
  return [...rows].sort((a, b) => {
    if (sort === 'school') return school(a).localeCompare(school(b)) || first(b).localeCompare(first(a))
    const d = first(a).localeCompare(first(b))
    return sort === 'newest' ? -d : d
  })
}

export function groupClasses<T extends GroupableClass>(
  rows: T[],
  opts: { today: string; query?: string; sort?: Partial<Record<ClassGroupKey, ClassSort>> }
): { key: ClassGroupKey; label: string; live: boolean; total: number; rows: T[] }[] {
  const q = opts.query ?? ''
  return CLASS_GROUPS.map((g) => {
    const all = rows.filter((c) => classGroup(c, opts.today) === g.key)
    const hits = q ? all.filter((c) => matchesSearch(c, q)) : all
    return { ...g, total: all.length, rows: sortClasses(hits, opts.sort?.[g.key] ?? 'newest') }
  })
}
