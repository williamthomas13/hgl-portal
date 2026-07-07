import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'

// Receipt PDF drawing (PHASE4_SPEC §3), shared by the /api/receipts route and
// the render-check script. Proper two-column item layout: names wrap within
// their column, prices right-align in a fixed-width column — long class names
// can never collide with the amounts.

export type ReceiptData = {
  label: string
  classPrice: number
  amountPaid: number
  paidAt: string | null // ISO date (YYYY-MM-DD)
  parentName: string
  parentEmail: string | null
  studentName: string
  refunded: boolean
  paymentRef: string | null
  addons: { name: string; hours: number; pricePaid: number }[]
}

const LEFT = 56
const RIGHT = 556
const NAME_COL_WIDTH = 380 // item names wrap inside [LEFT, LEFT+380]

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(attempt, size) <= maxWidth) {
      current = attempt
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

export async function buildReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const slate = rgb(0.2, 0.25, 0.33)
  const blue = rgb(0, 0.68, 0.93)
  const gray = rgb(0.35, 0.42, 0.5)

  const page = doc.addPage([612, 792]) // US Letter
  let y = 720

  page.drawText('Higher Ground Learning', { x: LEFT, y, size: 20, font: bold, color: slate })
  y -= 8
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 3, color: blue })
  y -= 30
  page.drawText('Receipt', { x: LEFT, y, size: 16, font: bold, color: slate })
  if (data.paidAt) {
    const dateText = formatDate(data.paidAt)
    page.drawText(dateText, {
      x: RIGHT - font.widthOfTextAtSize(dateText, 11),
      y,
      size: 11,
      font,
      color: gray,
    })
  }
  y -= 30

  const meta = (label: string, value: string) => {
    page.drawText(label, { x: LEFT, y, size: 11, font, color: gray })
    page.drawText(value, { x: 220, y, size: 11, font, color: slate })
    y -= 18
  }
  if (data.parentName) meta('Billed to', data.parentName)
  if (data.parentEmail) meta('Email', data.parentEmail)
  meta('Student', data.studentName)
  y -= 8

  page.drawText('Items', { x: LEFT, y, size: 13, font: bold, color: slate })
  y -= 22

  // Two-column item row: wrapped name left, right-aligned price.
  const item = (name: string, value: string, valueBold = false) => {
    const size = 11
    const nameLines = wrapText(name, font, size, NAME_COL_WIDTH)
    const priceFont = valueBold ? bold : font
    page.drawText(value, {
      x: RIGHT - priceFont.widthOfTextAtSize(value, size),
      y,
      size,
      font: priceFont,
      color: slate,
    })
    for (const line of nameLines) {
      page.drawText(line, { x: LEFT, y, size, font: valueBold ? bold : font, color: valueBold ? slate : gray })
      y -= 15
    }
    y -= 3
  }

  item(data.label, `$${data.classPrice.toLocaleString()}`)
  for (const a of data.addons) {
    item(`${a.name} — 1-on-1 tutoring (${a.hours}h)`, `$${a.pricePaid.toLocaleString()}`)
  }

  y -= 4
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1, color: gray })
  y -= 18
  item('Amount paid', `$${data.amountPaid.toLocaleString()}`, true)
  if (data.refunded) item('Status', 'Refunded', true)
  if (data.paymentRef) {
    page.drawText('Payment reference', { x: LEFT, y, size: 10, font, color: gray })
    page.drawText(data.paymentRef, {
      x: RIGHT - font.widthOfTextAtSize(data.paymentRef, 10),
      y,
      size: 10,
      font,
      color: gray,
    })
    y -= 18
  }

  y -= 20
  page.drawText('Questions? Reply to any of our emails or write info@highergroundlearning.com.', {
    x: LEFT, y, size: 9, font, color: gray,
  })

  return doc.save()
}
