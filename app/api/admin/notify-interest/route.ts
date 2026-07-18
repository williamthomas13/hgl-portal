import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { nextClassOpenEmail, sendOnce } from '../../../utils/email'
import { renderRegistered, tutoringStubContext } from '../../../utils/comms-registered'
import { contactBlockHtml, loadContactInfo } from '../../../utils/tutoring-emails'
import { formatDateAdmin } from '../../../utils/dates'

// PL-54c: drain the interest list for a newly opened class — triggered by
// the admin card's "N families are waiting — notify them?" prompt, never
// automatically (classes are sometimes created before they're ready to
// announce; the Ops Director picks the moment, the system does the
// remembering). Each unnotified row matching the class's school + type gets
// NW_NEXT_CLASS_OPEN (from info@) and is stamped notified_at; sends log with
// class_id so they show in comms History.

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { classId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.classId) return NextResponse.json({ error: 'Missing classId.' }, { status: 400 })

  const { data: cls } = await supabase
    .from('classes')
    .select(
      `id, slug, status, school_id, class_type, start_date,
       schools ( nickname ),
       sessions ( session_date, start_time )`
    )
    .eq('id', body.classId)
    .maybeSingle()
  if (!cls?.school_id) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  if (cls.status !== 'open') {
    return NextResponse.json({ error: 'Only open classes can be announced.' }, { status: 400 })
  }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const school: any = Array.isArray(cls.schools) ? cls.schools[0] : cls.schools
  const schoolNickname = school?.nickname ?? 'HGL'
  const firstSession =
    ((cls.sessions as { session_date: string }[]) ?? []).map((s) => s.session_date).sort()[0] ??
    cls.start_date
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const registrationLink = `${base}/register/${cls.slug ?? cls.id}?src=interest`
  const classSummaryLine = `<strong>${schoolNickname} ${cls.class_type}</strong> — starts ${formatDateAdmin(firstSession)}`

  const { data: waiting } = await supabase
    .from('class_interest')
    .select('id, email, parent_name')
    .eq('school_id', cls.school_id)
    .eq('class_type', cls.class_type)
    .is('notified_at', null)
  if (!waiting || waiting.length === 0) {
    return NextResponse.json({ ok: true, notified: 0 })
  }

  const contact = await loadContactInfo()
  let notified = 0
  for (const row of waiting) {
    const firstName = (row.parent_name ?? '').trim().split(/\s+/)[0] || 'there'
    const stub = { parentFirstName: firstName, parentEmail: row.email, schoolNickname, classType: cls.class_type }
    const email = await renderRegistered(
      'NW_NEXT_CLASS_OPEN',
      stub,
      { classSummaryLine, registrationLink, contactBlock: contactBlockHtml(contact) },
      () =>
        nextClassOpenEmail(tutoringStubContext(stub), {
          classSummaryLine,
          registrationLink,
          contactHtml: contactBlockHtml(contact),
        })
    )
    const status = await sendOnce({
      dedupeKey: `nw_open:${cls.id}:${row.email}`,
      emailType: 'next_class_open',
      classId: cls.id,
      to: [row.email],
      subject: email.subject,
      html: email.html,
    })
    if (status === 'sent' || status === 'duplicate') {
      await supabase
        .from('class_interest')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('notified_at', null)
      if (status === 'sent') notified++
    }
  }
  return NextResponse.json({ ok: true, notified, waiting: waiting.length })
}
