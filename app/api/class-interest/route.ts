import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { subscribeCompass } from '../../utils/compass'
import { renderDbEmail } from '../../utils/comms-db-render'
import { tutoringStubContext } from '../../utils/comms-registered'
import { contactBlockHtml, loadContactInfo } from '../../utils/tutoring-emails'
import { sendOnce } from '../../utils/email'
import { emailBaseUrl } from '../../utils/base-url'
import { interestUnsubscribeUrl } from '../../utils/interest'
import { EMAIL_RE, str } from '../../utils/public-forms'

// PL-54b: public "tell me when the next one opens" capture — the closed /
// full / cancelled registration states (and PL-378's between-classes code
// page). One email + a name; pure demand capture, no account, no payment.
// Re-submitting the same email just reconfirms (upsert dedupes on
// email × school × class_type).
// PL-484: a person, not just an address — first name required, last name +
// student first name optional (split, PL-466); the Compass opt-in (never
// pre-checked) subscribes through PL-477's ONE path; the confirmation
// CI_INTEREST_CONFIRM renders LIVE-ONLY (a draft sends nothing), one per
// address per school per 30 days, never to a suppressed address.

/* eslint-disable @typescript-eslint/no-explicit-any */
const thirtyDayBucket = () => Math.floor(Date.now() / (30 * 86_400_000))

async function confirmInterest(opts: {
  email: string
  firstName: string
  studentFirst: string | null
  schoolId: string | null
  schoolNickname: string
  schoolName: string
  classType: string
  rowId: string | null
}) {
  try {
    const { data: supp } = await supabase.from('marketing_suppressions').select('email').eq('email', opts.email).maybeSingle()
    if (supp) return
    const contact = await loadContactInfo()
    const ctx = tutoringStubContext({
      parentFirstName: opts.firstName,
      parentEmail: opts.email,
      studentFirstName: opts.studentFirst ?? '',
      schoolNickname: opts.schoolNickname,
      classType: opts.classType,
      schoolName: opts.schoolName,
    })
    const rendered = await renderDbEmail('CI_INTEREST_CONFIRM', ctx, 'parent', {
      contactBlock: contactBlockHtml(contact),
      studentFirstNameOrYourStudent: opts.studentFirst?.trim() || 'your student',
      inquireLink: `${emailBaseUrl()}/inquire?source=interest-confirm`,
      interestUnsubscribeLink: interestUnsubscribeUrl(opts.email),
    })
    if (!rendered) return // draft → nothing sends
    const status = await sendOnce({
      dedupeKey: `ci_confirm:${opts.email}:${opts.schoolId ?? 'open'}:${opts.classType}:${thirtyDayBucket()}`,
      emailType: 'interest_confirm',
      templateKey: 'CI_INTEREST_CONFIRM',
      to: [opts.email],
      from: rendered.from,
      subject: rendered.subject,
      html: rendered.html,
      bodySnapshotId: rendered.versionId,
    })
    if (status === 'sent' && opts.rowId) {
      await supabase.from('class_interest').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', opts.rowId)
    }
  } catch (e) {
    console.error('interest confirmation failed (row stands):', e)
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Honeypot: bots fill the invisible field; humans never do.
  if (str(body.company)) return NextResponse.json({ ok: true })

  const email = str(body.email)?.toLowerCase() ?? null
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }
  const firstName = str(body.firstName, 100)
  const lastName = str(body.lastName, 100)
  const studentFirst = str(body.studentFirst, 100)
  // Legacy callers sent a single studentName — keep it as the display name.
  const studentName = studentFirst ?? str(body.studentName, 200)
  const parentName = firstName ? `${firstName}${lastName ? ` ${lastName}` : ''}` : null
  const compassOptIn = body.compassOptIn === true

  let schoolId: string | null = null
  let classType: string | null = null
  let source = 'public_form'
  let schoolNickname = 'the next'
  let schoolName = 'Higher Ground Learning'
  if (body.evergreen === true) {
    // PL-378: the evergreen-link capture — no class row exists.
    classType = str(body.classType, 100)
    if (!classType) return NextResponse.json({ error: 'Missing class type.' }, { status: 400 })
    schoolId = str(body.schoolId, 100) || null
    source = 'evergreen-link'
  } else {
    const classId = str(body.classId, 100)
    if (!classId) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    // school + class_type come from the class row, never the client.
    const { data: cls } = await supabase
      .from('classes')
      .select('id, school_id, class_type')
      .or(`id.eq.${classId},slug.eq.${classId}`)
      .maybeSingle()
    if (!cls) return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
    schoolId = cls.school_id ?? null
    classType = cls.class_type
  }
  if (schoolId) {
    const { data: school } = await supabase.from('schools').select('nickname, name').eq('id', schoolId).maybeSingle()
    if (school) {
      schoolNickname = school.nickname ?? school.name
      schoolName = school.name
    }
  }

  const row = {
    email,
    parent_name: parentName,
    parent_first_name: firstName,
    parent_last_name: lastName,
    student_name: studentName,
    student_first_name: studentFirst,
    school_id: schoolId,
    class_type: classType,
    source,
    compass_opt_in: compassOptIn,
    unsubscribed_at: null, // a fresh sign-up re-opts a previously unsubscribed address
  }
  let rowId: string | null = null
  if (schoolId) {
    const { data, error } = await supabase
      .from('class_interest')
      .upsert(row, { onConflict: 'email,school_id,class_type', ignoreDuplicates: false })
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('class-interest upsert failed:', error.message)
      return NextResponse.json({ error: 'Something went wrong — please try again.' }, { status: 500 })
    }
    rowId = (data as any)?.id ?? null
  } else {
    // A null school never matches the unique constraint — insert-or-update by hand.
    const { data: existing } = await supabase.from('class_interest').select('id').eq('email', email).is('school_id', null).eq('class_type', classType!).maybeSingle()
    const res = existing
      ? await supabase.from('class_interest').update(row).eq('id', existing.id).select('id').maybeSingle()
      : await supabase.from('class_interest').insert([row]).select('id').maybeSingle()
    if (res.error) return NextResponse.json({ error: 'That did not save — try again?' }, { status: 500 })
    rowId = (res.data as any)?.id ?? null
  }

  if (compassOptIn) {
    await subscribeCompass({ email, firstName, source: 'interest-list' }).catch((e) => console.error('compass opt-in failed (interest stands):', e))
  }
  if (firstName) {
    await confirmInterest({ email, firstName, studentFirst, schoolId, schoolNickname, schoolName, classType: classType!, rowId })
  }
  return NextResponse.json({ ok: true })
}
