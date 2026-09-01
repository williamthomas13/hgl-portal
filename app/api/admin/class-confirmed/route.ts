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
  collateralMissing,
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

// PL-237: the no-collateral welcome — same email minus the attachments and
// the "I've attached the materials" paragraph. Unlike the announcement strip
// this one FAILS CLOSED: an email claiming attachments while carrying none
// must never go out, so marker drift refuses the send with a plain error.
const ATTACH_SENTENCE = " I've attached the materials for you:"
const ATTACH_BULLETS =
  '\n\n- A **letter** meant to be shared with parents (forward it in your parent communications, or print it)\n- A **flyer** meant for students — it works well on bulletin boards, hallway screens, and in student newsletters'

function stripAttachmentsParagraph(v: { body_markdown: string; preheader: string }): {
  body_markdown: string
  preheader: string
} | null {
  if (!v.body_markdown.includes(ATTACH_SENTENCE) || !v.body_markdown.includes(ATTACH_BULLETS)) {
    return null
  }
  const body = v.body_markdown.replace(ATTACH_SENTENCE, '').replace(ATTACH_BULLETS, '')
  const preheader = v.preheader
    .replace('materials attached, and', 'and')
    .replace(' — materials attached.', '.')
  return { body_markdown: body, preheader }
}

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
    .select('school_id, capacity, status, collateral_reminder_at, short_link')
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
      hasDiagnostics: model.hasDiagnostics,
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

  // PL-237: the collateral fork's dialog data — default the attachments OFF
  // when the wizard's skip-for-now reminder is still standing (the admin
  // explicitly deferred collateral), and offer the letter+flyer follow-up
  // once a no-collateral welcome is on record.
  const { data: ncSends } = await supabase
    .from('email_sends')
    .select('id')
    .like('dedupe_key', `class_confirmed_nc:${classId}:%`)
    .in('status', ['sending', 'sent', 'delivered'])
    .limit(1)

  // PL-449 amendment 2: the panel's contract — the composed preview AND the
  // exact attachment filenames are visible BEFORE any send (the POST
  // attaches these three, primary language, generated fresh at send).
  const attachLang = languagesFor(model)[0]
  const attachmentNames = [
    `${collateralFilename(model, 'letter', attachLang)}.pdf`,
    `${collateralFilename(model, 'flyer', attachLang)}.pdf`,
    `${collateralFilename(model, 'flyer', attachLang)}.jpg`,
  ]

  return NextResponse.json({
    ok: true,
    counselors: contactRows,
    schoolHasCompletedClass,
    defaultInclude,
    canSuppress,
    previews,
    // PL-449: why the preview may be absent — the panel says WHAT is missing
    // instead of a bare "Failed to load.".
    previewsMissingReason: previews
      ? null
      : !model.shortLink || !model.enrollmentDeadline
        ? `couldn't build the preview — the class record is missing ${[
            !model.shortLink && 'its printable link (set the school code in Classes → Short links)',
            !model.enrollmentDeadline && 'the enrollment deadline',
          ]
            .filter(Boolean)
            .join(' and ')}`
        : "couldn't build the preview — the email template failed to render (tell Code)",
    attachmentNames,
    // PL-449 soft-fail note: the flyer prints the school NAME in the logo
    // slot until a logo is uploaded — say so instead of surprising anyone.
    logoNote: model.hasSchool && !model.schoolLogoUrl
      ? 'School logo missing — the flyer shows the school name in its place. Upload the logo under Classes → Schools.'
      : null,
    defaultIncludeCollateral: !(cls.collateral_reminder_at && !cls.short_link),
    ncSendOnRecord: (ncSends?.length ?? 0) > 0,
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
  // PL-237: include_collateral=false sends the no-collateral welcome (no
  // attachments, attachments paragraph stripped — fail-closed); mode
  // 'collateral_followup' sends ONLY the letter + flyer, available once a
  // no-collateral welcome is on record for the class.
  const includeCollateral = body.include_collateral !== false
  const mode = body.mode === 'collateral_followup' ? 'collateral_followup' : 'welcome'

  const model = await loadCollateralModel(classId)
  if (!model) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })

  // The email promises a live sales page, a deadline, and a set calendar —
  // refuse plainly (never send a half-true welcome) until each exists.
  // PL-429: ONE readiness source (collateralMissing) — the artifact endpoint
  // and counselor materials block refuse on the same facts now.
  // PL-237: the collateral-only follow-up doesn't link the sales page, so it
  // only needs the sessions the attachments print.
  const missing =
    mode === 'welcome'
      ? collateralMissing(model)
      : model.sessions.length === 0
        ? ['the session calendar (add sessions first)']
        : []
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
  // format and language for later downloads). PL-237: skipped entirely for
  // the no-collateral welcome — no attachments means no Chromium renders.
  const wantsAttachments = mode === 'collateral_followup' || includeCollateral
  const lang = languagesFor(model)[0]
  let attachments: { filename: string; content: Buffer }[] = []
  let stage = 'load-assets'
  if (wantsAttachments) try {
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
  const today = new Date().toISOString().slice(0, 10)

  // PL-237: the collateral-only follow-up — letter + flyer without repeating
  // the class-is-ready text. Only offered (and only allowed) once a
  // no-collateral welcome is on record for this class.
  if (mode === 'collateral_followup') {
    const { data: ncSends } = await supabase
      .from('email_sends')
      .select('id')
      .like('dedupe_key', `class_confirmed_nc:${classId}:%`)
      .in('status', ['sending', 'sent', 'delivered'])
      .limit(1)
    if (!ncSends?.length) {
      return NextResponse.json(
        { error: 'No no-collateral welcome is on record for this class — send the "class is ready" welcome instead (with or without the attachments).' },
        { status: 400 }
      )
    }
    const results: { email: string; status: string }[] = []
    for (const c of counselors) {
      const rendered = await renderDbEmail(
        'CS_COLLATERAL_FOLLOWUP',
        tutoringStubContext({
          parentFirstName: c.first_name ?? 'there',
          parentEmail: c.email,
          schoolNickname: model.schoolNickname,
          schoolName: model.schoolName,
          classType: model.classType,
          firstSession: model.firstSession,
          hasDiagnostics: model.hasDiagnostics,
        }),
        'parent',
        { ...extra, counselorFirstName: c.first_name ?? 'there' }
      )
      if (!rendered) {
        return NextResponse.json(
          { error: 'The follow-up template is not live — flip "CS-F — Letter + flyer follow-up" live in the template editor first.' },
          { status: 400 }
        )
      }
      const status = await sendOnce({
        dedupeKey: `collateral_followup:${classId}:${c.email.toLowerCase()}:${today}`,
        emailType: 'counselor_collateral_followup',
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
          ? `Letter + flyer sent to ${results.filter((r) => r.status === 'sent').map((r) => r.email).join(', ')}.${dup ? ` (${dup} already sent today.)` : ''}`
          : dup
            ? 'Already sent today to everyone on file — no duplicate went out.'
            : 'Nothing sent — check the send log.',
    })
  }

  // PL-225 B: strip the announcement section when the admin unchecked the
  // box. Fail-open on marker drift — full email sends, response says so.
  // PL-237: the attachments strip chains on top and FAILS CLOSED — an email
  // claiming attachments while carrying none must never go out.
  let announcementStripped = false
  let attachmentsStripped = false
  const transform =
    includeAnnouncement && includeCollateral
      ? undefined
      : (v: { body_markdown: string; preheader: string }) => {
          let out = v
          if (!includeAnnouncement) {
            const r = stripAnnouncement(out)
            if (r) {
              announcementStripped = true
              out = r
            }
          }
          if (!includeCollateral) {
            const r = stripAttachmentsParagraph(out)
            if (r) {
              attachmentsStripped = true
              out = r
            }
          }
          return out
        }

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
        hasDiagnostics: model.hasDiagnostics,
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
    if (!includeCollateral && !attachmentsStripped) {
      // Fail closed BEFORE anything sends — nothing has gone out yet.
      return NextResponse.json(
        { error: "The no-collateral version couldn't be prepared — the template's attachments paragraph has changed and wasn't found. Nothing was sent. Send with the collateral included, or fix the template copy first." },
        { status: 400 }
      )
    }
    const status = await sendOnce({
      // Once per counselor per class per day — a same-day double press
      // dedupes; a genuine re-announce after edits works tomorrow. The
      // no-collateral variant keys separately: it's what makes the
      // letter+flyer follow-up offerable later.
      dedupeKey: `${includeCollateral ? 'class_confirmed' : 'class_confirmed_nc'}:${classId}:${c.email.toLowerCase()}:${today}`,
      emailType: 'counselor_class_confirmed',
      classId,
      to: [c.email],
      from: rendered.from,
      subject: rendered.subject,
      html: rendered.html,
      bodySnapshotId: rendered.versionId,
      ...(includeCollateral ? { attachments } : {}),
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
            .join(', ')}${includeCollateral ? ' with the letter and flyer attached' : ' WITHOUT the letter and flyer (send the follow-up from the collateral card when they want the materials)'}.${dup ? ` (${dup} already sent today.)` : ''}${announcementNote}`
        : dup
          ? 'Already sent today to everyone on file — no duplicate went out.'
          : 'Nothing sent — check the send log.',
  })
}
