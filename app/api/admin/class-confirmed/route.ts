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

// PL-225 B: the forwardable sample announcement is written in new-partnership
// voice, so it should only go to a NEW school or a NEW contact. The template
// stays the single copy source; when the admin unchecks the box we strip the
// section between these exact live-copy markers before render — and if
// Scarlett's edits ever move them, we FAIL OPEN (send the full email, note it
// in the response) rather than send something surgically wrong.
const ANNOUNCE_HEADING = '**A sample announcement you can forward'
const ANNOUNCE_LEAD_IN =
  'Below is a sample email you could use to introduce the course to students and parents. '
const PREHEADER_TAIL = ', and a sample announcement you can forward.'

function stripAnnouncement(v: { body_markdown: string; preheader: string }): {
  body_markdown: string
  preheader: string
} | null {
  const i = v.body_markdown.indexOf(ANNOUNCE_HEADING)
  if (i < 0) return null
  let body = v.body_markdown.slice(0, i).trimEnd()
  body = body.replace(ANNOUNCE_LEAD_IN, '')
  const preheader = v.preheader.includes(PREHEADER_TAIL)
    ? v.preheader.replace(PREHEADER_TAIL, '.')
    : v.preheader
  return { body_markdown: body, preheader }
}

function csExtraVars(model: NonNullable<Awaited<ReturnType<typeof loadCollateralModel>>>, capacity: number | null) {
  const salesPage = model.shortLink!.startsWith('http') ? model.shortLink! : `https://${model.shortLink}`
  return {
    salesPageLink: salesPage,
    collateralLanguagesPhrase:
      languagesFor(model).length > 1 ? ' and language (English and Spanish)' : '',
    courseDatesPhrase:
      model.firstSession === model.lastSession
        ? `on ${fmtMonthDay(model.firstSession)}`
        : `from ${fmtMonthDay(model.firstSession)} to ${fmtMonthDay(model.lastSession)}`,
    enrollmentDeadline: fmtLong(model.enrollmentDeadline!),
    classCapacity: String(capacity ?? model.capacity),
  }
}

async function loadCounselors(schoolId: string) {
  const { data: affs } = await supabase
    .from('school_affiliations')
    .select('contacts ( id, first_name, last_name, email )')
    .eq('school_id', schoolId)
    .is('ended_at', null)
  return ((affs as any[]) ?? []).map((a) => one<any>(a.contacts)).filter((c) => c?.email)
}

/** The send dialog's data: recipients, the include-the-announcement default
 *  (heuristic — the portal can't see pre-2026-07-20 history, so the admin
 *  always confirms), and with/without previews reflecting the toggle. */
export async function GET(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(request.url)
  const classId = url.searchParams.get('class_id') ?? ''
  if (!classId) return NextResponse.json({ error: 'Missing class id.' }, { status: 400 })

  const model = await loadCollateralModel(classId)
  if (!model) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  const { data: cls } = await supabase
    .from('classes')
    .select('school_id, capacity, status')
    .eq('id', classId)
    .single()
  if (!cls) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })

  const counselors = await loadCounselors(cls.school_id)
  const emails = counselors.map((c) => String(c.email).toLowerCase())
  const { data: prior } = emails.length
    ? await supabase
        .from('email_sends')
        .select('recipient_email')
        .eq('template_key', 'CS_CLASS_CONFIRMED')
        .eq('is_test', false)
        .in('status', ['scheduled', 'sending', 'sent', 'delivered'])
        .in('recipient_email', emails)
    : { data: [] }
  const priorSet = new Set((prior ?? []).map((r: any) => String(r.recipient_email).toLowerCase()))

  // "School already knows us": any OTHER non-cancelled class at the school
  // whose sessions have all passed.
  const { data: sibs } = await supabase
    .from('classes')
    .select('id, status, sessions ( session_date )')
    .eq('school_id', cls.school_id)
    .neq('id', classId)
    .neq('status', 'cancelled')
  const today = new Date().toISOString().slice(0, 10)
  const schoolHasCompletedClass = ((sibs as any[]) ?? []).some((s) => {
    const dates = ((s.sessions as any[]) ?? []).map((x) => x.session_date)
    return dates.length > 0 && dates.every((d) => d < today)
  })

  const contactRows = counselors.map((c) => ({
    email: c.email,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
    priorCs: priorSet.has(String(c.email).toLowerCase()),
  }))
  const everyContactPrior = contactRows.length > 0 && contactRows.every((c) => c.priorCs)
  const defaultInclude = !(schoolHasCompletedClass || everyContactPrior)

  // Previews (skippable when the class isn't fully set up yet — the POST's
  // readiness gate names what's missing at send time).
  let previews: { include: string; exclude: string } | null = null
  let canSuppress = false
  if (model.shortLink && model.enrollmentDeadline) {
    const extra = csExtraVars(model, cls.capacity)
    const stub = tutoringStubContext({
      parentFirstName: contactRows[0]?.name?.split(' ')[0] ?? 'there',
      parentEmail: contactRows[0]?.email ?? 'counselor@example.com',
      schoolNickname: model.schoolNickname,
      schoolName: model.schoolName,
      classType: model.classType,
      firstSession: model.firstSession,
    })
    const vars = { ...extra, counselorFirstName: contactRows[0]?.name?.split(' ')[0] ?? 'there' }
    const withA = await renderDbEmail('CS_CLASS_CONFIRMED', stub, 'parent', vars)
    let strippedWorked = false
    const withoutA = await renderDbEmail('CS_CLASS_CONFIRMED', stub, 'parent', vars, (v) => {
      const r = stripAnnouncement(v)
      if (r) {
        strippedWorked = true
        return r
      }
      return v
    })
    canSuppress = strippedWorked
    if (withA && withoutA) previews = { include: withA.html, exclude: withoutA.html }
  }

  return NextResponse.json({
    ok: true,
    counselors: contactRows,
    schoolHasCompletedClass,
    defaultInclude,
    canSuppress,
    previews,
  })
}

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
  // PL-225 B: omitted → include (the pre-dialog behavior); the send dialog
  // always passes it explicitly.
  const includeAnnouncement = body.include_announcement !== false

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
  const counselors = await loadCounselors(cls.school_id)
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

  const extra = csExtraVars(model, cls.capacity)

  // PL-225 B: strip the announcement section when the admin unchecked the
  // box. Fail-open on marker drift — full email sends, response says so.
  let announcementStripped = false
  const transform = includeAnnouncement
    ? undefined
    : (v: { body_markdown: string; preheader: string }) => {
        const r = stripAnnouncement(v)
        if (r) {
          announcementStripped = true
          return r
        }
        return v
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
      { ...extra, counselorFirstName: c.first_name ?? 'there' },
      transform
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
  const announcementNote = !includeAnnouncement
    ? announcementStripped
      ? ' The sample announcement was left out.'
      : " Heads up: the sample announcement could NOT be left out — the template's copy has changed and the section marker wasn't found, so the full email (announcement included) went out."
    : ''
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
            .join(', ')} with the letter and flyer attached.${dup ? ` (${dup} already sent today.)` : ''}${announcementNote}`
        : dup
          ? 'Already sent today to everyone on file — no duplicate went out.'
          : 'Nothing sent — check the send log.',
  })
}
