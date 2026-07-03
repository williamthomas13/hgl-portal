import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  classStartingEmail,
  loadEnrollmentContext,
  recipients,
  sendOnce,
  sessionReminderEmail,
} from '../../../utils/email'

// Daily reminder sweep, triggered by Vercel Cron (see vercel.json).
// Idempotent: every send is deduped through email_log, so re-running the
// same day (or a missed day catching up) never double-sends.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

const TIMEZONE = process.env.CLASS_TIMEZONE ?? 'America/Mexico_City'

function localDatePlusDays(days: number) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return d.toLocaleDateString('en-CA', { timeZone: TIMEZONE }) // YYYY-MM-DD
}

async function paidEnrollmentIds(classIds: string[]) {
  if (classIds.length === 0) return []
  const { data, error } = await supabase
    .from('enrollments')
    .select('id, class_id')
    .in('class_id', classIds)
    .eq('payment_status', 'Paid')
  if (error) {
    console.error('Failed to load paid enrollments:', error.message)
    return []
  }
  return data ?? []
}

export async function GET(req: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when the env var is set.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = { class_starting: 0, session_reminder: 0, failed: 0 }

  // 1. "Class starts in 3 days"
  const startDate = localDatePlusDays(3)
  const { data: startingClasses } = await supabase
    .from('classes')
    .select('id')
    .eq('start_date', startDate)

  for (const en of await paidEnrollmentIds((startingClasses ?? []).map((c) => c.id))) {
    const ctx = await loadEnrollmentContext(en.id)
    if (!ctx) continue
    const { subject, html } = classStartingEmail(ctx)
    const status = await sendOnce({
      dedupeKey: `class_starting:${en.id}`,
      emailType: 'class_starting',
      enrollmentId: en.id,
      to: recipients(ctx),
      subject,
      html,
    })
    if (status === 'sent') results.class_starting++
    if (status === 'failed') results.failed++
  }

  // 2. "Session tomorrow"
  const sessionDate = localDatePlusDays(1)
  const { data: tomorrowSessions } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, start_time, end_time, location')
    .eq('session_date', sessionDate)

  const sessionsByClass = new Map<string, typeof tomorrowSessions>()
  for (const s of tomorrowSessions ?? []) {
    const list = sessionsByClass.get(s.class_id) ?? []
    list.push(s)
    sessionsByClass.set(s.class_id, list)
  }

  for (const en of await paidEnrollmentIds([...sessionsByClass.keys()])) {
    const ctx = await loadEnrollmentContext(en.id)
    if (!ctx) continue
    for (const session of sessionsByClass.get(en.class_id) ?? []) {
      const { subject, html } = sessionReminderEmail(ctx, session)
      const status = await sendOnce({
        dedupeKey: `session_reminder:${en.id}:${session.id}`,
        emailType: 'session_reminder',
        enrollmentId: en.id,
        sessionId: session.id,
        to: recipients(ctx),
        subject,
        html,
      })
      if (status === 'sent') results.session_reminder++
      if (status === 'failed') results.failed++
    }
  }

  return NextResponse.json({ ok: true, date: localDatePlusDays(0), sent: results })
}
