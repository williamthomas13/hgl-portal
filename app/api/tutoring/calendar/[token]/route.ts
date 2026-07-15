import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { verifyTutoringIcsToken } from '../../../../utils/tutoring-billing'

// Per-family tutoring ICS feed (Phase 7d §8 — extends the class calendar
// pattern). Serves confirmed sessions from 30 days back onward; calendar
// apps re-fetch, so reschedules propagate. Signed-link auth, no login.

function icsEscape(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function icsUtc(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export async function GET(request: Request, ctx: RouteContext<'/api/tutoring/calendar/[token]'>) {
  const { token } = await ctx.params
  const familyId = verifyTutoringIcsToken(token.replace(/\.ics$/, ''))
  if (!familyId) return new Response('Not found', { status: 404 })

  const { data: sessions } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, starts_at, ends_at, status,
       students!inner ( first_name, family_id ),
       tutoring_engagements ( location, subjects ( name ) ),
       instructors ( name, default_location )`
    )
    .eq('students.family_id', familyId)
    .eq('status', 'confirmed')
    .gte('starts_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order('starts_at')

  const dtstamp = icsUtc(new Date().toISOString())
  const events = ((sessions as any[]) ?? []).map((s) => {
    const student = one<any>(s.students)
    const eng = one<any>(s.tutoring_engagements)
    const tutor = one<any>(s.instructors)
    const location = eng?.location ?? tutor?.default_location ?? null
    const lines = [
      'BEGIN:VEVENT',
      `UID:tutoring-${s.id}@hgl-portal`,
      `DTSTAMP:${dtstamp}`,
      `SUMMARY:${icsEscape(`Tutoring: ${student?.first_name ?? ''} — ${one<any>(eng?.subjects)?.name ?? ''}`)}`,
      `DTSTART:${icsUtc(s.starts_at)}`,
      `DTEND:${icsUtc(s.ends_at)}`,
    ]
    if (location) lines.push(`LOCATION:${icsEscape(location)}`)
    if (tutor?.name) lines.push(`DESCRIPTION:${icsEscape(`Tutor: ${tutor.name}`)}`)
    lines.push('END:VEVENT')
    return lines.join('\r\n')
  })

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HGL Portal//Tutoring//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape('HGL Tutoring')}`,
    ...events,
    'END:VCALENDAR',
  ].join('\r\n')

  const download = new URL(request.url).searchParams.get('download') === '1'
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      ...(download ? { 'Content-Disposition': 'attachment; filename="hgl-tutoring.ics"' } : {}),
    },
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
