import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { freeBusy, listBusyEvents, loadGcalConnection, GcalApiError } from '../../../utils/gcal'
import { sessionRole } from '../../../utils/staff-gate'

// Busy blocks for the Ops Director's slot picker (§4: "availability read"). Staff-only.
// Returns busy ranges from the tutor's self-managed calendar blocking plus
// their pushed sessions; the UI shades them behind proposed slots. A Google
// failure degrades to "availability unknown" — conflict checks warn, never
// block, so scheduling continues regardless.
// Body: { tutorId, timeMin, timeMax } (ISO datetimes, ≤ ~6 week range).
export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { tutorId?: string; timeMin?: string; timeMax?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { tutorId, timeMin, timeMax } = body
  if (!tutorId || !timeMin || !timeMax) {
    return NextResponse.json({ error: 'Pass tutorId, timeMin, timeMax.' }, { status: 400 })
  }
  const spanMs = new Date(timeMax).getTime() - new Date(timeMin).getTime()
  if (!(spanMs > 0) || spanMs > 45 * 86_400_000) {
    return NextResponse.json({ error: 'Range must be positive and at most 45 days.' }, { status: 400 })
  }

  const { data: tutor } = await supabase
    .from('instructors')
    .select('email, google_calendar_id, timezone')
    .eq('id', tutorId)
    .maybeSingle()
  if (!tutor) return NextResponse.json({ error: 'Unknown tutor.' }, { status: 404 })

  const conn = await loadGcalConnection()
  if (!conn?.key || conn.status !== 'connected') {
    return NextResponse.json({ available: false, reason: 'not_connected', busy: [] })
  }

  // events.list first so the warning can NAME the conflict ("Conflicts with:
  // Lincoln Swenson @ HGL, 2:30–3:30"); private events keep title null. Plain
  // freebusy is the fallback — titles degrade, shading survives.
  try {
    const busy = await listBusyEvents(
      conn.key,
      tutor.email,
      tutor.google_calendar_id,
      timeMin,
      timeMax,
      tutor.timezone ?? 'America/Denver'
    )
    return NextResponse.json({ available: true, busy })
  } catch (e) {
    const message = e instanceof GcalApiError ? e.message : e instanceof Error ? e.message : String(e)
    console.error(`events.list failed for tutor ${tutorId}, falling back to freebusy:`, message)
  }
  try {
    const busy = await freeBusy(conn.key, tutor.email, tutor.google_calendar_id, timeMin, timeMax)
    return NextResponse.json({
      available: true,
      busy: busy.map((b) => ({ ...b, title: null, private: false, allDay: false })),
    })
  } catch (e) {
    const message = e instanceof GcalApiError ? e.message : e instanceof Error ? e.message : String(e)
    console.error(`freebusy failed for tutor ${tutorId}:`, message)
    return NextResponse.json({ available: false, reason: 'gcal_error', busy: [] })
  }
}
