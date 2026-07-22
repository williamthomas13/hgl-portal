import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { loadClassBundles, localDate } from '../../../utils/lifecycle'
import {
  loadClassInstructor,
  sendInstructorWelcome,
  syncInstructorClassCalendar,
} from '../../../utils/instructor-comms'

// PL-78/79: the comms_enabled switch — flipping it ON is the one-time
// backfill moment: IN_WELCOME for every current live assignment + calendar
// events for upcoming sessions (both idempotent; the hourly cron converges
// anything this misses). Flipping OFF stops future sends, and the next
// calendar sweep removes the instructor's future events.

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { instructorId?: string; enabled?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.instructorId || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Missing instructor or enabled flag.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('instructors')
    .update({ comms_enabled: body.enabled })
    .eq('id', body.instructorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Backfill (or cleanup) behind the response.
  const instructorId = body.instructorId
  after(async () => {
    try {
      const bundles = await loadClassBundles()
      const mine = bundles.filter(
        (b) =>
          b.instructorId === instructorId &&
          b.status !== 'cancelled' &&
          localDate(b.timezone) <= b.lastSession
      )
      for (const bundle of mine) {
        const instructor = await loadClassInstructor(bundle)
        if (instructor) await sendInstructorWelcome(bundle, instructor)
        await syncInstructorClassCalendar(bundle) // also removes events on disable
      }
    } catch (e) {
      console.error('instructor comms backfill failed (cron converges):', e)
    }
  })

  return NextResponse.json({ ok: true })
}
