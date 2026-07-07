import { loadClassBundles } from '../../../../utils/lifecycle'

// Per-class ICS feed generated from the sessions table.
// Same URL serves both semantics:
//   - one-time download:  /api/classes/{id}/calendar.ics?download=1
//   - subscription feed:  webcal://…/api/classes/{id}/calendar.ics
//     (calendar apps re-fetch it, so session changes propagate)
// Events carry the school-local TZID; per-session location falls back to the
// class default (physical room or meeting link alike).

function icsEscape(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function icsDateTime(date: string, time: string) {
  return `${date.replace(/-/g, '')}T${time.replace(/:/g, '').padEnd(6, '0').slice(0, 6)}`
}

function icsDate(date: string) {
  return date.replace(/-/g, '')
}

export async function GET(request: Request, ctx: RouteContext<'/api/classes/[id]/calendar.ics'>) {
  const { id } = await ctx.params
  const [bundle] = await loadClassBundles(id)
  if (!bundle) {
    return new Response('Class not found', { status: 404 })
  }

  const calName = `${bundle.schoolLabel} — ${bundle.classType}`
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'

  // Cancelled class: publish an empty feed so subscribed calendars clear
  // their events on the next re-fetch (PHASE4_SPEC §12).
  const sessions = bundle.status === 'cancelled' ? [] : bundle.sessions

  const events = sessions.map((s) => {
    const location = s.location ?? bundle.defaultLocation
    const lines = [
      'BEGIN:VEVENT',
      `UID:session-${s.id}@hgl-portal`,
      `DTSTAMP:${dtstamp}`,
      `SUMMARY:${icsEscape(calName)}`,
    ]
    if (s.start_time) {
      lines.push(`DTSTART;TZID=${bundle.timezone}:${icsDateTime(s.session_date, s.start_time)}`)
      lines.push(
        `DTEND;TZID=${bundle.timezone}:${icsDateTime(s.session_date, s.end_time ?? s.start_time)}`
      )
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(s.session_date)}`)
    }
    if (location) lines.push(`LOCATION:${icsEscape(location)}`)
    if (bundle.instructorName) lines.push(`DESCRIPTION:${icsEscape(`Instructor: ${bundle.instructorName}`)}`)
    lines.push('END:VEVENT')
    return lines.join('\r\n')
  })

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Higher Ground Learning//HGL Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`,
    `X-WR-TIMEZONE:${bundle.timezone}`,
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n')

  const download = new URL(request.url).searchParams.get('download')
  const filename = `${bundle.schoolLabel}-${bundle.classType}`.replace(/[^\w-]+/g, '-') + '.ics'
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      ...(download ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}),
      'Cache-Control': 'public, max-age=300', // subscription clients re-fetch
    },
  })
}
