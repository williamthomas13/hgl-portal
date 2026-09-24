import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { aggregateResults, resultsCsv, type ClassFacts, type ScoreRow } from '../../../utils/results-aggregate'
import { classTerm } from '../../../utils/class-groups'

// PL-504: the all-time results view — every class-linked score row, folded
// by results-aggregate.ts (one pure function; the CSV export is the same
// numbers). Staff, read-only. ?csv=1 downloads.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const [{ data: scores, error }, { data: classes }] = await Promise.all([
    supabase.from('student_scores').select('student_id, class_id, test_label, section_scores, total, taken_at, created_at').not('class_id', 'is', null),
    supabase.from('classes').select('id, slug, class_type, start_date, school_id, status, schools ( nickname, name )').neq('status', 'cancelled'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const facts: ClassFacts[] = ((classes as any[]) ?? []).map((c) => ({
    id: c.id, slug: c.slug, class_type: c.class_type, start_date: c.start_date, school_id: c.school_id,
    schoolNickname: one<any>(c.schools)?.nickname ?? null, schoolName: one<any>(c.schools)?.name ?? null, term: classTerm(c),
  }))
  const agg = aggregateResults((scores as ScoreRow[]) ?? [], facts)
  if (new URL(req.url).searchParams.get('csv') === '1') {
    return new NextResponse(resultsCsv(agg), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="hgl-results-${new Date().toISOString().slice(0, 10)}.csv"` },
    })
  }
  return NextResponse.json({ results: agg, generatedAt: new Date().toISOString() })
}
