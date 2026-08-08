import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { cohortWindow, extensionTarget, foLongDate } from '../../../utils/follow-on-shared'

// PL-279: extend ONE feeder cohort's follow-up discount window — a
// deliberate admin action (never automatic: the stage-3 "we extended the
// discount" story is only honest when someone chose to extend). Sets the
// feeder's fo_extended_until a week past the current effective deadline;
// the next hourly sweep sends the extension pair to that cohort (once the
// FO templates are live).

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { classId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.classId) return NextResponse.json({ error: 'Pass classId.' }, { status: 400 })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: cls } = await supabase
    .from('classes')
    .select(
      'id, start_date, follow_on_class_id, fo_extended_until, fo_announce_date, fo_discount_end, fo_exclude, sessions ( session_date )'
    )
    .eq('id', body.classId)
    .maybeSingle()
  if (!cls) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  if (!cls.follow_on_class_id) {
    return NextResponse.json(
      { error: 'This class has no follow-up class linked — nothing to extend.' },
      { status: 400 }
    )
  }
  if (cls.fo_exclude) {
    return NextResponse.json(
      { error: 'This cohort is excluded from the follow-up campaign — nothing to extend.' },
      { status: 400 }
    )
  }
  const dates = ((cls.sessions as any[]) ?? []).map((s) => s.session_date).sort()
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const window = cohortWindow({
    lastSession: dates[dates.length - 1] ?? cls.start_date,
    foExtendedUntil: cls.fo_extended_until,
    foAnnounceDate: cls.fo_announce_date,
    foDiscountEnd: cls.fo_discount_end,
  })
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  const until = extensionTarget(window, today)

  const { error } = await supabase
    .from('classes')
    .update({ fo_extended_until: until })
    .eq('id', body.classId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    until,
    untilLong: foLongDate(until),
    wasExtended: window.extended,
  })
}
