import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { sendOnce } from '../../../utils/email'
import { renderDbEmail } from '../../../utils/comms-db-render'
import { tutoringStubContext } from '../../../utils/comms-registered'
import {
  collateralFilename,
  languagesFor,
  loadCollateralModel,
} from '../../../utils/collateral'
import { flyerHtml, letterHtml } from '../../../utils/collateral-templates'
import {
  loadStaticAssets,
  qrDataUrl,
  renderHtml,
  schoolLogoDataUrl,
  signatureDataUrl,
} from '../../../utils/collateral-render'

// PL-214: the CS class-confirmed welcome — the "your class is set up" email
// the counselor sequence never had (it replaces the manual note Billy sends
// after class setup). Admin-INITIATED: a button on the class's collateral
// card, never a blind automation. Attaches the parent letter PDF + student
// flyer PDF and JPG, generated fresh from live class data at send time (the
// same Phase 4.5 render the download endpoints use). Copy comes exclusively
// from the CS_CLASS_CONFIRMED registry template (Scarlett's final copy —
// there is deliberately NO code twin to drift from it).

export const maxDuration = 120 // three headless-Chromium renders + send

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

const fmtLong = (iso: string) =>
  new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
const fmtMonthDay = (iso: string) =>
  new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

export async function POST(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const classId = String(body.class_id ?? '')
  if (!classId) return NextResponse.json({ error: 'Missing class id.' }, { status: 400 })

  const model = await loadCollateralModel(classId)
  if (!model) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })

  // The email promises a live sales page, a deadline, and a set calendar —
  // refuse plainly (never send a half-true welcome) until each exists.
  const missing: string[] = []
  if (model.sessions.length === 0) missing.push('the session calendar (add sessions first)')
  if (!model.shortLink) missing.push("the school sales-page short link (set it on the class — it's what the email links)")
  if (!model.enrollmentDeadline) missing.push('the enrollment deadline')
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Not ready to send — still missing: ${missing.join(' · ')}.` },
      { status: 400 }
    )
  }

  const { data: cls } = await supabase
    .from('classes')
    .select('school_id, capacity, status')
    .eq('id', classId)
    .single()
  if (!cls) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  if (cls.status === 'cancelled') {
    return NextResponse.json({ error: 'This class is cancelled — nothing to announce.' }, { status: 400 })
  }

  // Every ACTIVE counselor affiliation at the school gets the welcome.
  const { data: affs } = await supabase
    .from('school_affiliations')
    .select('contacts ( id, first_name, last_name, email )')
    .eq('school_id', cls.school_id)
    .is('ended_at', null)
  const counselors = ((affs as any[]) ?? [])
    .map((a) => one<any>(a.contacts))
    .filter((c) => c?.email)
  if (counselors.length === 0) {
    return NextResponse.json(
      { error: 'No active school contact on file — add one in the Contacts directory first.' },
      { status: 400 }
    )
  }

  // Collateral, generated fresh (primary language; the portal carries every
  // format and language for later downloads).
  const lang = languagesFor(model)[0]
  let attachments: { filename: string; content: Buffer }[]
  let stage = 'load-assets'
  try {
    const [statics, qr, signature, processedLogo] = await Promise.all([
      loadStaticAssets(),
      qrDataUrl(model.registerUrl),
      signatureDataUrl(),
      schoolLogoDataUrl(model.schoolLogoUrl),
    ])
    model.schoolLogoUrl = processedLogo
    const assets = { ...statics, qrDataUrl: qr, signatureDataUrl: signature }
    stage = 'render-letter'
    const letterPdf = await renderHtml(letterHtml(model, lang, assets), 'pdf')
    stage = 'render-flyer-pdf'
    const flyerPdf = await renderHtml(flyerHtml(model, lang, assets), 'pdf')
    stage = 'render-flyer-jpg'
    const flyerJpg = await renderHtml(flyerHtml(model, lang, assets), 'jpg')
    attachments = [
      { filename: `${collateralFilename(model, 'letter', lang)}.pdf`, content: letterPdf },
      { filename: `${collateralFilename(model, 'flyer', lang)}.pdf`, content: flyerPdf },
      { filename: `${collateralFilename(model, 'flyer', lang)}.jpg`, content: flyerJpg },
    ]
  } catch (e) {
    console.error(`CS collateral generation failed at ${stage} for class ${classId}:`, e)
    return NextResponse.json(
      { error: 'Could not generate the letter/flyer attachments — the error has been logged. Try again in a minute.' },
      { status: 500 }
    )
  }

  const salesPage = model.shortLink!.startsWith('http')
    ? model.shortLink!
    : `https://${model.shortLink}`
  const extra = {
    salesPageLink: salesPage,
    collateralLanguagesPhrase:
      languagesFor(model).length > 1 ? ' and language (English and Spanish)' : '',
    courseDatesPhrase:
      model.firstSession === model.lastSession
        ? `on ${fmtMonthDay(model.firstSession)}`
        : `from ${fmtMonthDay(model.firstSession)} to ${fmtMonthDay(model.lastSession)}`,
    enrollmentDeadline: fmtLong(model.enrollmentDeadline!),
    classCapacity: String(cls.capacity ?? model.capacity),
  }

  const today = new Date().toISOString().slice(0, 10)
  const results: { email: string; status: string }[] = []
  for (const c of counselors) {
    const rendered = await renderDbEmail(
      'CS_CLASS_CONFIRMED',
      tutoringStubContext({
        parentFirstName: c.first_name ?? 'there',
        parentEmail: c.email,
        schoolNickname: model.schoolNickname,
        schoolName: model.schoolName,
        classType: model.classType,
        firstSession: model.firstSession,
      }),
      'parent',
      { ...extra, counselorFirstName: c.first_name ?? 'there' }
    )
    if (!rendered) {
      return NextResponse.json(
        { error: 'The CS template is not live — flip "CS — Counselor class-confirmed welcome" live in the template editor first.' },
        { status: 400 }
      )
    }
    const status = await sendOnce({
      // Once per counselor per class per day — a same-day double press
      // dedupes; a genuine re-announce after edits works tomorrow.
      dedupeKey: `class_confirmed:${classId}:${c.email.toLowerCase()}:${today}`,
      emailType: 'counselor_class_confirmed',
      classId,
      to: [c.email],
      from: rendered.from,
      subject: rendered.subject,
      html: rendered.html,
      bodySnapshotId: rendered.versionId,
      attachments,
    })
    results.push({ email: c.email, status })
  }

  const sent = results.filter((r) => r.status === 'sent').length
  const dup = results.filter((r) => r.status === 'duplicate').length
  return NextResponse.json({
    ok: true,
    sent,
    duplicate: dup,
    results,
    message:
      sent > 0
        ? `Sent to ${results
            .filter((r) => r.status === 'sent')
            .map((r) => r.email)
            .join(', ')} with the letter and flyer attached.${dup ? ` (${dup} already sent today.)` : ''}`
        : dup
          ? 'Already sent today to everyone on file — no duplicate went out.'
          : 'Nothing sent — check the send log.',
  })
}
