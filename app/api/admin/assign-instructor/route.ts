import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { syncInternationalCalendar } from '../../../utils/intl-calendar'

// PL-249/PL-250: the one path for assigning (or changing) a class's
// instructor outside the creation wizard — used by the availability
// calendar's "assign to class" and the roster's inline instructor select.
// The hourly instructor-comms sweep converges welcome/digest emails and the
// instructor's own calendar events; the shared International Classes
// calendar resyncs on the fast path here, same as cancel-class.

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const classId = typeof body?.classId === 'string' ? body.classId : ''
  // null unassigns (roster select's "not yet assigned" option).
  const instructorId = typeof body?.instructorId === 'string' ? body.instructorId : null
  if (!classId) return NextResponse.json({ error: 'Pass classId.' }, { status: 400 })

  const { data: cls } = await supabase
    .from('classes')
    .select('id, status, class_type, instructor_id, schools ( nickname )')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return NextResponse.json({ error: 'Unknown class.' }, { status: 404 })
  if (cls.status === 'cancelled') {
    return NextResponse.json({ error: 'This class is cancelled — pick an active class to staff.' }, { status: 400 })
  }

  let instructorName: string | null = null
  if (instructorId) {
    const { data: inst } = await supabase
      .from('instructors')
      .select('id, name, email, active')
      .eq('id', instructorId)
      .maybeSingle()
    if (!inst) return NextResponse.json({ error: 'Unknown instructor.' }, { status: 404 })
    if (!inst.active) {
      return NextResponse.json(
        { error: `${inst.name ?? inst.email} is no longer an active instructor — reactivate them first.` },
        { status: 400 }
      )
    }
    instructorName = inst.name ?? inst.email
  }

  const { error } = await supabase.from('classes').update({ instructor_id: instructorId }).eq('id', classId)
  if (error) {
    return NextResponse.json({ error: "Couldn't save the assignment — try again." }, { status: 500 })
  }

  after(() =>
    syncInternationalCalendar(classId).catch((e) => console.error('intl sync after assign failed:', e))
  )

  return NextResponse.json({ ok: true, instructorName })
}
