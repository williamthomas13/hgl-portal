import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { verifyTutoringIcsToken } from '../../../../utils/tutoring-billing'

// PL-40: the family's tutoring schedule as a simple PDF — the download
// button in the T_SCHEDULE_SET welcome email. Same signed family token as
// the ICS feed; upcoming confirmed sessions, rendered in the family's
// timezone. Reuses the class schedule.pdf look (pdf-lib, US Letter).

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export async function GET(_request: Request, ctx: RouteContext<'/api/tutoring/schedule.pdf/[token]'>) {
  const { token } = await ctx.params
  const familyId = verifyTutoringIcsToken(token.replace(/\.pdf$/, ''))
  if (!familyId) return new Response('Not found', { status: 404 })

  const [{ data: family }, { data: sessions }] = await Promise.all([
    supabase.from('families').select('timezone').eq('id', familyId).maybeSingle(),
    supabase
      .from('tutoring_sessions')
      .select(
        `id, starts_at, ends_at, status,
         students!inner ( first_name, last_name, family_id ),
         tutoring_engagements ( location, subjects ( name ) ),
         instructors ( name, timezone, default_location )`
      )
      .eq('students.family_id', familyId)
      .eq('status', 'confirmed')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(60),
  ])

  const rows = ((sessions as any[]) ?? []).map((s) => {
    const student = one<any>(s.students)
    const eng = one<any>(s.tutoring_engagements)
    const tutor = one<any>(s.instructors)
    return {
      startsAt: s.starts_at as string,
      endsAt: s.ends_at as string,
      student: student?.first_name ?? '',
      subject: one<any>(eng?.subjects)?.name ?? 'Tutoring',
      tutor: (tutor?.name ?? '').split(' ')[0],
      location: eng?.location ?? tutor?.default_location ?? null,
      tz: family?.timezone ?? tutor?.timezone ?? 'America/Denver',
    }
  })

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const slate = rgb(0.2, 0.25, 0.33)
  const blue = rgb(0, 0.68, 0.93)
  const gray = rgb(0.35, 0.42, 0.5)

  let page = doc.addPage([612, 792])
  let y = 720
  page.drawText('Higher Ground Learning', { x: 56, y, size: 20, font: bold, color: slate })
  y -= 8
  page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 3, color: blue })
  y -= 30
  page.drawText('1-on-1 tutoring schedule', { x: 56, y, size: 16, font: bold, color: slate })
  y -= 18
  if (rows[0]) {
    page.drawText(`Times shown in ${rows[0].tz.split('/').pop()?.replace('_', ' ')}`, {
      x: 56,
      y,
      size: 10,
      font,
      color: gray,
    })
    y -= 24
  }

  if (rows.length === 0) {
    page.drawText('No upcoming sessions on the calendar yet — new sessions appear here', {
      x: 56, y, size: 11, font, color: gray,
    })
    y -= 14
    page.drawText('as soon as they are scheduled.', { x: 56, y, size: 11, font, color: gray })
  }

  for (const r of rows) {
    if (y < 80) {
      page = doc.addPage([612, 792])
      y = 720
    }
    const d = new Date(r.startsAt)
    const e = new Date(r.endsAt)
    const day = d.toLocaleDateString('en-US', {
      timeZone: r.tz,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    const t1 = d.toLocaleTimeString('en-US', { timeZone: r.tz, hour: 'numeric', minute: '2-digit' })
    const t2 = e.toLocaleTimeString('en-US', { timeZone: r.tz, hour: 'numeric', minute: '2-digit' })
    page.drawText(day, { x: 56, y, size: 11, font: bold, color: slate })
    page.drawText(`${t1} – ${t2}`, { x: 300, y, size: 11, font, color: slate })
    y -= 14
    page.drawText(
      `${r.student} — ${r.subject}${r.tutor ? ` with ${r.tutor}` : ''}${r.location ? ` · ${r.location}` : ''}`.slice(0, 95),
      { x: 56, y, size: 9.5, font, color: gray }
    )
    y -= 20
  }

  const bytes = await doc.save()
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="hgl-tutoring-schedule.pdf"',
      'Cache-Control': 'private, no-store',
    },
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
