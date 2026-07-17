import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { sendAdminAlert } from '../../utils/email'
import { ADMIN_EMAIL } from '../../utils/lifecycle'

// PL-38: public website inquiry → a prospective student at the top of the
// pipeline. Replaces the "email → Kelsie transcribes" loop: Squarespace's
// "Get started" buttons point here (or embed the form). Deliberately short —
// this is a cold inquiry; the fuller intake form (PL-36) is sent later once
// there's a real conversation. No auth: throttled by the honeypot + the
// utter absence of anything to gain (it only creates a pipeline row).

const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Honeypot: real parents never fill the invisible field.
  if (str(body.company)) return NextResponse.json({ ok: true })

  const parentName = str(body.parentName, 200)
  const parentEmail = str(body.parentEmail, 200)?.toLowerCase() ?? null
  const parentPhone = str(body.parentPhone, 50)
  if (!parentName || !parentEmail) {
    return NextResponse.json({ error: 'Please give us your name and email so we can reply.' }, { status: 400 })
  }
  if (!/^\S+@\S+\.\S+$/.test(parentEmail)) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
  }

  const studentName = str(body.studentName, 200)
  const studentSchool = str(body.studentSchool, 200)
  const subject = str(body.subject, 300)
  const connectPref = str(body.connectPref, 40)
  const other = str(body.other, 2000)
  const src = str(body.src, 100) ?? 'website form'

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
      contact_name: parentName,
      contact_email: parentEmail,
      contact_phone: parentPhone,
      student_name: studentName,
      student_school: studentSchool,
      interest,
      subjects: subject,
      notes,
    })
    .select('id')
    .single()
  if (error || !lead) {
    console.error('inquiry insert failed:', error?.message)
    return NextResponse.json(
      { error: 'Something went wrong — please email us instead and we will get right back to you.' },
      { status: 500 }
    )
  }

  await sendAdminAlert({
    dedupeKey: `web_inquiry:${lead.id}`,
    adminEmail: ADMIN_EMAIL,
    subject: `New inquiry — ${studentName ?? parentName}`,
    body: `<p><strong>${parentName}</strong> (${parentEmail}${parentPhone ? `, ${parentPhone}` : ''})
      asked about ${subject ?? 'tutoring'}${studentName ? ` for <strong>${studentName}</strong>` : ''}.</p>
      <p>They're at the top of the prospective-students pipeline — /admin/leads.</p>`,
  }).catch((e) => console.error('inquiry alert failed (row stands):', e))

  return NextResponse.json({ ok: true })
}
