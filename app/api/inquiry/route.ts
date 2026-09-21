import { emailBaseUrl } from '../../utils/base-url'
import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { sendAdminAlert, sendOnce } from '../../utils/email'
import { ADMIN_EMAIL } from '../../utils/lifecycle'
import { FORM_CORS_HEADERS } from '../../utils/embed-forms'
import { renderDbEmail } from '../../utils/comms-db-render'
import { tutoringStubContext } from '../../utils/comms-registered'
import { contactBlockHtml, loadContactInfo } from '../../utils/tutoring-emails'
import { EMAIL_RE, composePhone, ipThrottled, recentDuplicate, str } from '../../utils/public-forms'

// PL-38: public website inquiry → a prospective student at the top of the
// pipeline. Replaces the "email → Kelsie transcribes" loop: Squarespace's
// "Get started" buttons point here (or embed the form). Deliberately short —
// this is a cold inquiry; the fuller intake form (PL-36) is sent later once
// there's a real conversation. No auth: throttled by the honeypot + the
// utter absence of anything to gain (it only creates a pipeline row).
// PL-473: the embed (/embed/inquire.js) posts here cross-origin (CORS
// below); `source` / `interestTag` tag the lead (source_detail /
// interest_tag) and a "School partnership" interest is routed to the school
// lane (kind='school') instead of the family pipeline.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: FORM_CORS_HEADERS })

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: FORM_CORS_HEADERS })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  // Honeypot: real parents never fill the invisible field.
  if (str(body.company)) return json({ ok: true })
  if (ipThrottled(req)) return json({ error: 'Too many requests — please try again in a few minutes.' }, 429)

  const parentName = str(body.parentName, 200)
  const parentEmail = str(body.parentEmail, 200)?.toLowerCase() ?? null
  const parentPhone = composePhone(body.parentPhoneCountry, body.parentPhone)
  if (!parentName || !parentEmail) {
    return json({ error: 'Please give us your name and email so we can reply.' }, 400)
  }
  if (!EMAIL_RE.test(parentEmail)) {
    return json({ error: 'That email address does not look right.' }, 400)
  }
  // Per-email throttle: a double-submit or replay inside 10 minutes gets a
  // friendly OK and no second pipeline row.
  if (await recentDuplicate('leads', 'contact_email', parentEmail)) return json({ ok: true, duplicate: true })

  const studentName = str(body.studentName, 200)
  const studentSchool = str(body.studentSchool, 200)
  const subject = str(body.subject, 300)
  const connectPref = str(body.connectPref, 40)
  const other = str(body.other, 2000)
  const src = str(body.source, 100) ?? str(body.src, 100) ?? 'website form'
  const interestTag = str(body.interestTag, 100) ?? (subject && /^(SAT|ACT|AP\/IB|University applications|GRE\/GMAT|Academic support|School partnership)$/.test(subject) ? subject : null)
  const isSchool = interestTag === 'School partnership' || subject === 'School partnership'

  // Light interest guess from the subject text — Kelsie refines in the
  // pipeline; 'unsure' is an honest default.
  const interest = subject && /\b(SAT|ACT|PSAT|GRE|GED|GMAT|LSAT|MCAT|ISEE|SSAT|Praxis)\b/i.test(subject)
    ? 'test_prep'
    : subject
      ? 'subject'
      : 'unsure'

  const notes = [
    `Web inquiry via ${src}.`,
    connectPref ? `Prefers to connect by: ${connectPref}.` : null,
    other ? `Other info: ${other}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      source: 'website',
      status: 'new',
      kind: isSchool ? 'school' : 'family',
      source_detail: src,
      interest_tag: interestTag,
      contact_name: parentName,
      contact_email: parentEmail,
      contact_phone: parentPhone,
      student_name: studentName,
      student_school: studentSchool,
      interest,
      subjects: subject,
      notes,
      ...(isSchool ? { partner: { school: studentSchool, message: other } } : {}),
    })
    .select('id')
    .single()
  if (error || !lead) {
    console.error('inquiry insert failed:', error?.message)
    return json({ error: 'Something went wrong — please email us instead and we will get right back to you.' }, 500)
  }

  await sendAdminAlert({
    dedupeKey: `web_inquiry:${lead.id}`,
    adminEmail: ADMIN_EMAIL,
    subject: isSchool ? `New school-partnership inquiry — ${studentSchool ?? parentName}` : `New inquiry — ${studentName ?? parentName}`,
    body: `<p><strong>${parentName}</strong> (${parentEmail}${parentPhone ? `, ${parentPhone}` : ''})
      asked about ${subject ?? 'tutoring'}${studentName ? ` for <strong>${studentName}</strong>` : ''}${studentSchool ? ` (${studentSchool})` : ''}.</p>
      <p style="font-size:13px;color:#64748b">Came in via <strong>${src}</strong>${interestTag ? ` · interest: <strong>${interestTag}</strong>` : ''}.</p>
      <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin/leads?lead=${lead.id}${isSchool ? '&kind=school' : ''}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open the lead record</a>
      — ${isSchool ? "they're in the Schools lane of prospective students." : "they're at the top of the prospective-students pipeline."}</p>`,
  }).catch((e) => console.error('inquiry alert failed (row stands):', e))

  // IQ_INQUIRY_ACK: the auto-reply — LIVE-ONLY (a draft renders null → nothing sends).
  try {
    const contact = await loadContactInfo()
    const ctx = tutoringStubContext({ parentFirstName: parentName.split(' ')[0], parentEmail: parentEmail, studentFirstName: '', studentLastName: '' })
    const rendered = await renderDbEmail('IQ_INQUIRY_ACK', ctx, 'parent', { contactBlock: contactBlockHtml(contact) })
    if (rendered) {
      await sendOnce({
        dedupeKey: `inquiry_ack:${lead.id}`,
        emailType: 'inquiry_ack',
        templateKey: 'IQ_INQUIRY_ACK',
        to: [parentEmail],
        from: rendered.from,
        subject: rendered.subject,
        html: rendered.html,
        bodySnapshotId: rendered.versionId,
      })
    }
  } catch (e) {
    console.error('inquiry_ack auto-reply failed (row stands):', e)
  }

  return json({ ok: true })
}
