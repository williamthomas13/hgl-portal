import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'

// PL-281: match a tutor to a QBO Employee (instructors.qbo_employee_id).
// Match-ONLY — the portal never creates QBO employees; the dropdown offers
// QBO's own Employee list (catalog route). Admin-only, same boundary as the
// item mapping. Null clears the match.
export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { instructorId?: string; qboEmployeeId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const instructorId = (body.instructorId ?? '').trim()
  if (!instructorId) return NextResponse.json({ error: 'Pass instructorId.' }, { status: 400 })
  const qboEmployeeId = (body.qboEmployeeId ?? '').toString().trim() || null

  const { data, error } = await supabase
    .from('instructors')
    .update({ qbo_employee_id: qboEmployeeId })
    .eq('id', instructorId)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No such instructor.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
