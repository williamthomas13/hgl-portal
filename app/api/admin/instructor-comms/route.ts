import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { loadClassBundles, localDate } from '../../../utils/lifecycle'
import {
  loadClassInstructor,
  sendInstructorWelcome,
  syncInstructorClassCalendar,
} from '../../../utils/instructor-comms'

// PL-78/79 → PL-327: the old boolean comms_enabled switch is ABSORBED into
// per-type preferences (notes reminders · class digests+pings · FYI copies).
// Staff set them here (admin override lives in the instructor editor);
// tutors self-serve the same fields from their portal. Turning class digests
// ON is still the one-time backfill moment: IN_WELCOME for every current
// live assignment + calendar events (idempotent; the hourly cron converges
// anything missed). Turning them OFF stops future sends and the next
// calendar sweep removes the instructor's future events.

const NOTE_PREFS = ['on', 'weekly', 'off'] as const
const DIGEST_PREFS = ['on', 'weekly', 'off'] as const

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: {
    instructorId?: string
    /** Legacy shape (pre-PL-327 clients): maps to digests+FYI on/off. */
    enabled?: boolean
    prefs?: {
      pref_notes_reminders?: string
      pref_class_digests?: string
      pref_fyi_copies?: boolean
    }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.instructorId || (typeof body.enabled !== 'boolean' && !body.prefs)) {
    return NextResponse.json({ error: 'Missing instructor or preferences.' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') {
    patch.pref_class_digests = body.enabled ? 'on' : 'off'
    patch.pref_fyi_copies = body.enabled
    patch.comms_enabled = body.enabled // keeps the not-yet-dropped column honest
  }
  if (body.prefs) {
    const p = body.prefs
    if (p.pref_notes_reminders !== undefined) {
      if (!NOTE_PREFS.includes(p.pref_notes_reminders as never)) {
        return NextResponse.json({ error: 'Notes reminders: on, weekly, or off.' }, { status: 400 })
      }
      patch.pref_notes_reminders = p.pref_notes_reminders
    }
    if (p.pref_class_digests !== undefined) {
      if (!DIGEST_PREFS.includes(p.pref_class_digests as never)) {
        return NextResponse.json({ error: 'Class digests: on, weekly, or off.' }, { status: 400 })
      }
      patch.pref_class_digests = p.pref_class_digests
      patch.comms_enabled = p.pref_class_digests !== 'off'
    }
    if (p.pref_fyi_copies !== undefined) patch.pref_fyi_copies = p.pref_fyi_copies === true
  }

  const { error } = await supabase.from('instructors').update(patch).eq('id', body.instructorId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Backfill (or cleanup) behind the response — only the digest pref moves
  // welcome emails and calendar events.
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
