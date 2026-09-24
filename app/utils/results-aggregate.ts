// PL-504: the all-time results aggregate — ONE pure function over score rows
// (the /admin/results page, its CSV export and the regress gate all run it).
// Per student-per-class: initial = the earliest test, final = the latest
// DIFFERENT test (the class report's own rule). A student counts as
// "scored" with an initial, "improved" when final > initial.

export type ScoreRow = {
  student_id: string
  class_id: string
  test_label: string
  section_scores: Record<string, number | string> | null
  total: number | string | null
  taken_at: string | null
  created_at?: string | null
}
export type ClassFacts = {
  id: string
  slug: string | null
  class_type: string
  start_date: string | null
  school_id: string | null
  schoolNickname: string | null
  schoolName: string | null
  term: string | null
}

export type Bucket = {
  key: string
  label: string
  /** first session / start date of the earliest class in the bucket */
  from: string | null
  to: string | null
  scored: number
  withFinal: number
  improved: number
  pctImproved: number | null
  avgInitial: number | null
  avgFinal: number | null
  avgImprovement: number | null
  bySection: Record<string, { avgInitial: number | null; avgFinal: number | null; avgImprovement: number | null; n: number }>
}

const r1 = (n: number) => Math.round(n * 10) / 10
const avg = (ns: number[]) => (ns.length ? r1(ns.reduce((a, b) => a + b, 0) / ns.length) : null)

type Pair = { studentId: string; classId: string; initial: { total: number; sections: Record<string, number> }; final: { total: number; sections: Record<string, number> } | null }

export function pairScores(rows: ScoreRow[]): Pair[] {
  const byKey = new Map<string, ScoreRow[]>()
  for (const r of rows) {
    if (!r.class_id) continue
    const k = `${r.student_id}|${r.class_id}`
    byKey.set(k, [...(byKey.get(k) ?? []), r])
  }
  const toS = (r: ScoreRow) => ({
    total: Number(r.total),
    sections: Object.fromEntries(Object.entries(r.section_scores ?? {}).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number))) as Record<string, number>,
  })
  const out: Pair[] = []
  for (const [k, list] of byKey) {
    const sorted = [...list].sort((a, b) => String(a.taken_at ?? '9999').localeCompare(String(b.taken_at ?? '9999')) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    const first = sorted[0]
    if (first.total == null || !Number.isFinite(Number(first.total))) continue
    const last = sorted.length > 1 ? sorted[sorted.length - 1] : null
    const [studentId, classId] = k.split('|')
    out.push({ studentId, classId, initial: toS(first), final: last && last.total != null ? toS(last) : null })
  }
  return out
}

function bucketOf(key: string, label: string, pairs: Pair[], classes: Map<string, ClassFacts>): Bucket {
  const withFinal = pairs.filter((p) => p.final)
  const gains = withFinal.map((p) => p.final!.total - p.initial.total)
  const sectionsSeen = [...new Set(pairs.flatMap((p) => Object.keys(p.initial.sections)))]
  const bySection: Bucket['bySection'] = {}
  for (const s of sectionsSeen) {
    const both = withFinal.filter((p) => p.initial.sections[s] != null && p.final!.sections[s] != null)
    bySection[s] = {
      n: both.length,
      avgInitial: avg(pairs.filter((p) => p.initial.sections[s] != null).map((p) => p.initial.sections[s])),
      avgFinal: avg(both.map((p) => p.final!.sections[s])),
      avgImprovement: avg(both.map((p) => p.final!.sections[s] - p.initial.sections[s])),
    }
  }
  const dates = pairs.map((p) => classes.get(p.classId)?.start_date ?? null).filter((d): d is string => Boolean(d)).sort()
  return {
    key, label,
    from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
    scored: pairs.length,
    withFinal: withFinal.length,
    improved: gains.filter((g) => g > 0).length,
    pctImproved: gains.length ? Math.round((gains.filter((g) => g > 0).length / gains.length) * 100) : null,
    avgInitial: avg(pairs.map((p) => p.initial.total)),
    avgFinal: avg(withFinal.map((p) => p.final!.total)),
    avgImprovement: avg(gains),
    bySection,
  }
}

export type ResultsAggregate = {
  allTime: Bucket
  marketing: { avgImprovement: number | null; pctImproved: number | null; studentsServed: number; n: number; from: string | null; to: string | null }
  bySchool: Bucket[]
  byClass: (Bucket & { classId: string; slug: string | null; classType: string; startDate: string | null; school: string | null; term: string | null })[]
  byTerm: Bucket[]
}

export function aggregateResults(rows: ScoreRow[], classList: ClassFacts[]): ResultsAggregate {
  const classes = new Map(classList.map((c) => [c.id, c]))
  const pairs = pairScores(rows).filter((p) => classes.has(p.classId))
  const allTime = bucketOf('all', 'All time', pairs, classes)
  const group = (keyOf: (c: ClassFacts) => string | null, labelOf: (c: ClassFacts) => string) => {
    const m = new Map<string, { label: string; pairs: Pair[] }>()
    for (const p of pairs) {
      const c = classes.get(p.classId)!
      const k = keyOf(c) ?? '—'
      const e = m.get(k) ?? { label: labelOf(c), pairs: [] }
      e.pairs.push(p)
      m.set(k, e)
    }
    return [...m.entries()].map(([k, e]) => bucketOf(k, e.label, e.pairs, classes))
  }
  const termOrder = (t: string) => { const m = /^(spring|summer|fall|autumn|winter)(\d{2,4})$/.exec(t); if (!m) return t; const y = m[2].length === 2 ? `20${m[2]}` : m[2]; const s = { spring: 1, summer: 2, fall: 3, autumn: 3, winter: 4 }[m[1]] ?? 0; return `${y}-${s}` }
  const byClass = group((c) => c.id, (c) => `${c.schoolNickname ?? (c.school_id ? c.schoolName : 'HGL')} ${c.class_type}${c.term ? ` ${c.term}` : ''}`)
    .map((b) => { const c = classes.get(b.key)!; return { ...b, classId: c.id, slug: c.slug, classType: c.class_type, startDate: c.start_date, school: c.schoolNickname ?? c.schoolName, term: c.term } })
    .sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? '')))
  const students = new Set(pairs.map((p) => p.studentId))
  return {
    allTime,
    marketing: { avgImprovement: allTime.avgImprovement, pctImproved: allTime.pctImproved, studentsServed: students.size, n: allTime.withFinal, from: allTime.from, to: allTime.to },
    bySchool: group((c) => c.school_id ?? 'hgl', (c) => c.schoolNickname ?? c.schoolName ?? 'HGL (open classes)').sort((a, b) => a.label.localeCompare(b.label)),
    byClass,
    byTerm: group((c) => c.term, (c) => c.term ?? 'no term').sort((a, b) => termOrder(a.key).localeCompare(termOrder(b.key))),
  }
}

export function resultsCsv(agg: ResultsAggregate): string {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = [['scope', 'label', 'from', 'to', 'scored', 'with_final', 'improved', 'pct_improved', 'avg_initial', 'avg_final', 'avg_improvement', 'avg_improvement_rw', 'avg_improvement_math'].join(',')]
  const row = (scope: string, b: Bucket) => lines.push([scope, b.label, b.from, b.to, b.scored, b.withFinal, b.improved, b.pctImproved, b.avgInitial, b.avgFinal, b.avgImprovement, b.bySection['Reading & Writing']?.avgImprovement ?? '', b.bySection['Math']?.avgImprovement ?? ''].map(esc).join(','))
  row('all-time', agg.allTime)
  for (const b of agg.bySchool) row('school', b)
  for (const b of agg.byTerm) row('term', b)
  for (const b of agg.byClass) row('class', b)
  return lines.join('\n') + '\n'
}
