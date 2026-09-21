import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

// PL-484: the interest list per school for staff — JSON for the Schools
// panel, CSV export. Sign-ups are NOT leads (they never enter the pipeline
// unless the person also inquires); this is the "who is waiting" list.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(req.url)
  const schoolId = url.searchParams.get('school')
  const format = url.searchParams.get('format')
  let q = supabase
    .from('class_interest')
    .select('id, email, parent_name, parent_first_name, parent_last_name, student_name, student_first_name, class_type, source, compass_opt_in, created_at, notified_at, unsubscribed_at, school_id, schools ( nickname, name )')
    .order('created_at', { ascending: false })
  if (schoolId === 'none') q = q.is('school_id', null)
  else if (schoolId) q = q.eq('school_id', schoolId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = ((data as any[]) ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    firstName: r.parent_first_name ?? (r.parent_name ?? '').split(/\s+/)[0] ?? '',
    lastName: r.parent_last_name ?? (r.parent_name ?? '').split(/\s+/).slice(1).join(' '),
    studentFirst: r.student_first_name ?? r.student_name ?? '',
    classType: r.class_type,
    school: (Array.isArray(r.schools) ? r.schools[0] : r.schools)?.nickname ?? '',
    source: r.source,
    compass: Boolean(r.compass_opt_in),
    signedUp: r.created_at,
    notifiedAt: r.notified_at,
    unsubscribedAt: r.unsubscribed_at,
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (format === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['email', 'first_name', 'last_name', 'student_first_name', 'school', 'class_type', 'source', 'compass_opt_in', 'signed_up', 'notified_at', 'unsubscribed_at']
    const lines = [header.join(','), ...rows.map((r) => [r.email, r.firstName, r.lastName, r.studentFirst, r.school, r.classType, r.source, r.compass ? 'yes' : 'no', r.signedUp, r.notifiedAt ?? '', r.unsubscribedAt ?? ''].map(esc).join(','))]
    return new NextResponse(lines.join('\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="interest-list${schoolId ? `-${schoolId}` : ''}.csv"` },
    })
  }
  return NextResponse.json({ rows })
}
