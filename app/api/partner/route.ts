import { NextResponse } from 'next/server'
import { emailBaseUrl } from '../../utils/base-url'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { sendAdminAlert, sendOnce } from '../../utils/email'
import { ADMIN_EMAIL } from '../../utils/lifecycle'
import { FORM_CORS_HEADERS } from '../../utils/embed-forms'
import { renderDbEmail } from '../../utils/comms-db-render'
import { tutoringStubContext } from '../../utils/comms-registered'
import { contactBlockHtml, loadContactInfo } from '../../utils/tutoring-emails'
import { EMAIL_RE, composePhone, ipThrottled, recentDuplicate, str } from '../../utils/public-forms'

// PL-477: a school-partnership inquiry → a lead of KIND 'school' (its own
// lane; never a family). The partnership facts ride `partner` (jsonb); the
// staff alert names the school; converting it later creates the school + a
// contact through the PL-467 add-school path (leads API `create_school`).
// Auto-reply to the school contact: DRAFT template PT_PARTNER_ACK — renders
// only once Scarlett flips it live (registry-only; nothing sends meanwhile).

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
  if (str(body.company)) return json({ ok: true })
  if (ipThrottled(req)) return json({ error: 'Too many requests — please try again in a few minutes.' }, 429)

  const contactName = str(body.contactName, 200)
  const email = str(body.email, 200)?.toLowerCase() ?? null
  const school = str(body.school, 200)
  if (!contactName || !email || !school) return json({ error: 'Please give us your name, your email and the school.' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'That email address does not look right.' }, 400)
  if (await recentDuplicate('leads', 'contact_email', email)) return json({ ok: true, duplicate: true })

  const partner = {
    school,
    role: str(body.role, 200),
    location: str(body.location, 200),
    tests: str(body.tests, 100),
    cohortSize: str(body.cohortSize, 100),
    format: str(body.format, 100),
    timing: str(body.timing, 200),
    message: str(body.message, 2000),
  }
  const src = str(body.source, 100) ?? 'partner form'
  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      source: 'website',
      status: 'new',
      kind: 'school',
      source_detail: src,
      interest_tag: 'School partnership',
      contact_name: contactName,
      contact_email: email,
      contact_phone: composePhone(body.phoneCountry, body.phone),
      student_school: school,
      interest: 'test_prep',
      subjects: partner.tests,
      partner,
      notes: [`School-partnership inquiry via ${src}.`, partner.message ? `Message: ${partner.message}` : null].filter(Boolean).join('\n'),
    })
    .select('id')
    .single()
  if (error || !lead) {
    console.error('partner insert failed:', error?.message)
    return json({ error: 'Something went wrong — please email us instead and we will get right back to you.' }, 500)
  }

  await sendAdminAlert({
    dedupeKey: `partner_inquiry:${lead.id}`,
    adminEmail: ADMIN_EMAIL,
    subject: `New school-partnership inquiry — ${school}`,
    body: `<p><strong>${contactName}</strong>${partner.role ? ` (${partner.role})` : ''} at <strong>${school}</strong>${partner.location ? `, ${partner.location}` : ''} — ${email}${body.phone ? `, ${composePhone(body.phoneCountry, body.phone)}` : ''}.</p>
      <ul style="margin:0;padding-left:20px;color:#334155">
        ${partner.tests ? `<li>Tests: ${partner.tests}</li>` : ''}${partner.cohortSize ? `<li>Students: ${partner.cohortSize}</li>` : ''}${partner.format ? `<li>Format: ${partner.format}</li>` : ''}${partner.timing ? `<li>Timing: ${partner.timing}</li>` : ''}
      </ul>
      ${partner.message ? `<p style="white-space:pre-wrap">${partner.message}</p>` : ''}
      <p style="font-size:13px;color:#64748b">Came in via <strong>${src}</strong>.</p>
      <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin/leads?lead=${lead.id}&kind=school" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open the school lead</a>
      — the Schools lane of prospective students; "Create school + contact" is on the card.</p>`,
  }).catch((e) => console.error('partner alert failed (row stands):', e))

  // PT_PARTNER_ACK: the auto-reply — LIVE-ONLY (a draft renders null → nothing sends).
  try {
    const contact = await loadContactInfo()
    const ctx = tutoringStubContext({ parentFirstName: contactName.split(' ')[0], parentEmail: email, studentFirstName: '', studentLastName: '' })
    const rendered = await renderDbEmail('PT_PARTNER_ACK', ctx, 'parent', { contactBlock: contactBlockHtml(contact) })
    if (rendered) {
      await sendOnce({
        dedupeKey: `partner_ack:${lead.id}`,
        emailType: 'partner_ack',
        templateKey: 'PT_PARTNER_ACK',
        to: [email],
        from: rendered.from,
        subject: rendered.subject,
        html: rendered.html,
        bodySnapshotId: rendered.versionId,
      })
    }
  } catch (e) {
    console.error('partner_ack auto-reply failed (row stands):', e)
  }

  return json({ ok: true })
}
