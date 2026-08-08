import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'

// PL-313: the link-or-not decision surface's API. Staff (admin AND manager
// — Kelsie handles these too). GET lists a lead's pending matches with both
// records side by side; POST records the human decision:
//   link      → the lead connects to the existing family/student and is
//               marked converted-won (Started); NOTHING else merges.
//   not_same  → remembered on the pair; it never re-asks.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const leadId = new URL(req.url).searchParams.get('lead')
  if (!leadId) return NextResponse.json({ error: 'Pass ?lead=.' }, { status: 400 })

  const { data } = await supabase
    .from('record_matches')
    .select(
      `id, reasons, status, enrollment_id,
       students ( id, first_name, last_name, grade_level, school_id,
         families ( id, parent_first_name, parent_last_name, parent_email ) ),
       enrollments:enrollment_id ( id, payment_status, classes ( class_type, schools ( nickname ) ) )`
    )
    .eq('lead_id', leadId)
    .eq('status', 'pending')
  const matches = ((data as any[]) ?? []).map((m) => {
    const student = one<any>(m.students)
    const family = one<any>(student?.families)
    const enrollment = one<any>(m.enrollments)
    const cls = one<any>(enrollment?.classes)
    const school = one<any>(cls?.schools)
    return {
      id: m.id,
      reasons: m.reasons ?? [],
      student: student
        ? {
            id: student.id,
            name: `${student.first_name} ${student.last_name}`.trim(),
            grade: student.grade_level,
          }
        : null,
      family: family
        ? {
            id: family.id,
            parentName: `${family.parent_first_name} ${family.parent_last_name ?? ''}`.trim(),
            parentEmail: family.parent_email,
          }
        : null,
      enrollment: enrollment
        ? {
            id: enrollment.id,
            status: enrollment.payment_status,
            classLabel: cls ? `${school?.nickname ?? 'HGL'} ${cls.class_type}` : null,
          }
        : null,
    }
  })
  return NextResponse.json({ matches })
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { id?: string; action?: 'link' | 'not_same' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.id || !['link', 'not_same'].includes(body.action ?? '')) {
    return NextResponse.json({ error: 'Pass id and action (link | not_same).' }, { status: 400 })
  }

  const { data: match } = await supabase
    .from('record_matches')
    .select('id, lead_id, student_id, family_id, status')
    .eq('id', body.id)
    .maybeSingle()
  if (!match) return NextResponse.json({ error: 'Unknown match.' }, { status: 404 })
  if (match.status !== 'pending') {
    return NextResponse.json({ error: 'This pair was already decided.' }, { status: 400 })
  }

  if (body.action === 'link') {
    const { error } = await supabase
      .from('leads')
      .update({
        student_id: match.student_id,
        family_id: match.family_id,
        status: 'scheduled', // converted-won: the prospective student IS this student
        updated_at: new Date().toISOString(),
      })
      .eq('id', match.lead_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error: mErr } = await supabase
    .from('record_matches')
    .update({
      status: body.action === 'link' ? 'linked' : 'not_same',
      decided_at: new Date().toISOString(),
      decided_by: caller.email,
    })
    .eq('id', match.id)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
