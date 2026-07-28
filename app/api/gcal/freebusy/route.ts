import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { freeBusy, listBusyEvents, loadGcalConnection, GcalApiError } from '../../../utils/gcal'
import { holdActive } from '../../../utils/gcal-sync'
import { sessionRole } from '../../../utils/staff-gate'

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

/**
 * PL-159: PORTAL-side holds — proposed sessions count as busy in every
 * scheduling surface, calendar sync lag or outage notwithstanding. Fresh
 * new-schedule proposals and monthly-cycle proposals (active engagements)
 * hold; an expired hold does not.
 */
async function portalHolds(tutorId: string, timeMin: string, timeMax: string) {
  const { data } = await supabase
    .from('tutoring_sessions')
    .select(
      `starts_at, ends_at, status,
       students ( first_name ),
       tutoring_engagements ( status, approval_requested_at )`
    )
    .eq('tutor_id', tutorId)
    .eq('status', 'proposed')
    .lt('starts_at', timeMax)
    .gt('ends_at', timeMin)
  return ((data as any[]) ?? [])
    .filter((s) => {
      const eng = one<any>(s.tutoring_engagements)
      return holdActive(eng?.status ?? 'active', eng?.approval_requested_at ?? null)
    })
    .map((s) => ({
      start: s.starts_at,
      end: s.ends_at,
      title: `HOLD: proposed session — ${one<any>(s.students)?.first_name ?? 'a student'} (awaiting family confirmation)`,
      private: false,
      allDay: false,
    }))
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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

  const holds = await portalHolds(tutorId, timeMin, timeMax)

  const conn = await loadGcalConnection()
  if (!conn?.key || conn.status !== 'connected') {
    // PL-159: the portal's own holds still shade even with Google away.
    return NextResponse.json({ available: false, reason: 'not_connected', busy: holds })
  }

  // events.list first so the warning can NAME the conflict ("Conflicts with:
  // Lincoln Swenson @ HGL, 2:30–3:30"); private events keep title null. Plain
  // freebusy is the fallback — titles degrade, shading survives.
  // PL-159: the portal rows are the truth for holds — drop Google's copy of
  // our own HOLD events so a conflict never lists twice.
  const dedupeOwnHolds = (busy: { title?: string | null }[]) =>
    busy.filter((b) => !(b.title ?? '').startsWith('HOLD: Tutoring:'))
  try {
    const busy = await listBusyEvents(
      conn.key,
      tutor.email,
      tutor.google_calendar_id,
      timeMin,
      timeMax,
      tutor.timezone ?? 'America/Denver'
    )
    return NextResponse.json({ available: true, busy: [...dedupeOwnHolds(busy), ...holds] })
  } catch (e) {
    const message = e instanceof GcalApiError ? e.message : e instanceof Error ? e.message : String(e)
    console.error(`events.list failed for tutor ${tutorId}, falling back to freebusy:`, message)
  }
  try {
    const busy = await freeBusy(conn.key, tutor.email, tutor.google_calendar_id, timeMin, timeMax)
    return NextResponse.json({
      available: true,
      busy: [...busy.map((b) => ({ ...b, title: null, private: false, allDay: false })), ...holds],
    })
  } catch (e) {
    const message = e instanceof GcalApiError ? e.message : e instanceof Error ? e.message : String(e)
    console.error(`freebusy failed for tutor ${tutorId}:`, message)
    return NextResponse.json({ available: false, reason: 'gcal_error', busy: holds })
  }
}
