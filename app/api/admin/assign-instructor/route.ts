import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { syncInternationalCalendar } from '../../../utils/intl-calendar'
import { tutoringConflictsForClass, type AssignmentConflict } from '../../../utils/instructor-conflicts'

// PL-249/PL-250: the one path for assigning (or changing) a class's
// instructor outside the creation wizard — used by the availability
// calendar's "assign to class" and the roster's inline instructor select.
// The hourly instructor-comms sweep converges welcome/digest emails and the
// instructor's own calendar events; the shared International Classes
// calendar resyncs on the fast path here, same as cancel-class.
//
// PL-434: the response now carries the assignment's tutoring conflicts
// (deduped portal truth, the shared instructor-conflicts util) so every
// caller renders the resolve-next prompt — assigning over conflicts stays
// deliberate, but the conflicts stop just… existing.
//
// PL-435: an ONLINE class with no meeting link gains the instructor's
// default link on assignment (the wizard's own promise, provenance-stamped
// 'instructor_default'); an explicitly-set link is sacred; changing
// instructors re-applies only when the current link carries default
// provenance.

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
    .select('id, status, class_type, instructor_id, delivery_mode, default_location, default_location_source, schools ( nickname )')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return NextResponse.json({ error: 'Unknown class.' }, { status: 404 })
  if (cls.status === 'cancelled') {
    return NextResponse.json({ error: 'This class is cancelled — pick an active class to staff.' }, { status: 400 })
  }

  let instructorName: string | null = null
  let defaultLink: string | null = null
  if (instructorId) {
    const { data: inst } = await supabase
      .from('instructors')
      .select('id, name, email, active, default_meeting_link')
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
    defaultLink = (inst.default_meeting_link ?? '').trim() || null
  }

  // PL-435: provenance-aware link application. An admin/counselor-typed
  // location (source NULL with a value) is never touched; only an empty
  // location or one WE applied from a previous instructor's default moves.
  const patch: Record<string, unknown> = { instructor_id: instructorId }
  let appliedDefaultLink: string | null = null
  if (cls.delivery_mode === 'online') {
    const currentIsDefaultProvenance = cls.default_location_source === 'instructor_default'
    if (!cls.default_location || currentIsDefaultProvenance) {
      if (instructorId && defaultLink) {
        patch.default_location = defaultLink
        patch.default_location_source = 'instructor_default'
        if (defaultLink !== cls.default_location) appliedDefaultLink = defaultLink
      } else if (currentIsDefaultProvenance) {
        // The old instructor's default leaves with them — an empty honest
        // location beats a link to the wrong person's Zoom room.
        patch.default_location = null
        patch.default_location_source = null
      }
    }
  }

  const { error } = await supabase.from('classes').update(patch).eq('id', classId)
  if (error) {
    return NextResponse.json({ error: "Couldn't save the assignment — try again." }, { status: 500 })
  }

  // PL-434: the conflicts this assignment creates — computed AFTER the write
  // (the override is deliberate; the next step is resolving, per session).
  let conflicts: AssignmentConflict[] = []
  if (instructorId) {
    try {
      conflicts = await tutoringConflictsForClass(classId, instructorId)
    } catch (e) {
      console.error('assignment conflict check failed (assignment stands):', e)
    }
  }

  after(() =>
    syncInternationalCalendar(classId).catch((e) => console.error('intl sync after assign failed:', e))
  )

  return NextResponse.json({ ok: true, instructorName, conflicts, appliedDefaultLink })
}
