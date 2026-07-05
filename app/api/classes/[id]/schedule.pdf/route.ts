import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { loadClassBundles } from '../../../../utils/lifecycle'

// Simple formatted session list (dates, times, location) as a PDF.

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(t: string | null) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

export async function GET(_request: Request, ctx: RouteContext<'/api/classes/[id]/schedule.pdf'>) {
  const { id } = await ctx.params
  const [bundle] = await loadClassBundles(id)
  if (!bundle) {
    return new Response('Class not found', { status: 404 })
  }

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const slate = rgb(0.2, 0.25, 0.33)
  const blue = rgb(0, 0.68, 0.93)
  const gray = rgb(0.35, 0.42, 0.5)

  let page = doc.addPage([612, 792]) // US Letter
  let y = 720

  page.drawText('Higher Ground Learning', { x: 56, y, size: 20, font: bold, color: slate })
  y -= 8
  page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 3, color: blue })
  y -= 30
  page.drawText(`${bundle.schoolLabel} — ${bundle.classType}`, { x: 56, y, size: 16, font: bold, color: slate })
  y -= 20
  if (bundle.instructorName) {
    page.drawText(`Instructor: ${bundle.instructorName}`, { x: 56, y, size: 11, font, color: gray })
    y -= 16
  }
  if (bundle.defaultLocation) {
    page.drawText(`Location: ${bundle.defaultLocation}`, { x: 56, y, size: 11, font, color: gray })
    y -= 16
  }
  y -= 14
  page.drawText('Class schedule', { x: 56, y, size: 13, font: bold, color: slate })
  y -= 22

  if (bundle.sessions.length === 0) {
    page.drawText('Session dates to be announced.', { x: 56, y, size: 11, font, color: gray })
  }

  for (const [i, s] of bundle.sessions.entries()) {
    if (y < 72) {
      page = doc.addPage([612, 792])
      y = 720
    }
    const start = formatTime(s.start_time)
    const end = formatTime(s.end_time)
    const time = start ? (end ? `${start} – ${end}` : start) : 'Time TBD'
    const location = s.location ?? bundle.defaultLocation

    page.drawText(`Session ${i + 1}`, { x: 56, y, size: 10, font: bold, color: blue })
    page.drawText(formatDate(s.session_date), { x: 130, y, size: 11, font: bold, color: slate })
    y -= 15
    page.drawText(`${time}${location ? `  ·  ${location}` : ''}`, { x: 130, y, size: 10, font, color: gray })
    y -= 22
  }

  const bytes = await doc.save()
  const filename = `${bundle.schoolLabel}-${bundle.classType}-schedule`.replace(/[^\w-]+/g, '-') + '.pdf'
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
