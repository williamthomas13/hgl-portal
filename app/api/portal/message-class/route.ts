import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { createSupabaseServerClient } from '../../../utils/supabase-server'
import { FROM, footerT, sendOnce, wrap } from '../../../utils/email'

// Feature B3 (docs/COMMS_ATTENDANCE_PARENT_SPEC.md): send-from-portal class
// messaging. From "{instructorName} via Higher Ground Learning <info@…>",
// Reply-To the instructor — replies reach them without handing instructors
// raw send access to the domain identity. Every recipient gets an INDIVIDUAL
// send (no exposed lists), logged in email_sends as IM_INSTRUCTOR_MESSAGE
// with class_id + sender_email, so messages appear in the admin comms
// dashboard, the per-enrollment thread, and the instructor's own history
// (RLS self-read). Operational class messages = transactional footer, no
// unsubscribe, marketing_opt_out not consulted (spec).

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

/** Caller must be this class's instructor or staff; returns class + roster. */
async function authorizeForClass(classId: string) {
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) }
  const email = user.email.toLowerCase()

  const { data: cls } = await supabase
    .from('classes')
    .select(
      `id, class_type, schools ( nickname ), instructors ( name, email ),
       enrollments ( id, payment_status,
         students ( first_name, last_name, student_email,
           families ( parent_email, parent_first_name ) ) )`
    )
    .eq('id', classId)
    .single()
  if (!cls) return { error: NextResponse.json({ error: 'Class not found.' }, { status: 404 }) }

  const instructor = one<any>(cls.instructors as any)
  const isClassInstructor = instructor?.email?.toLowerCase() === email
  if (!isClassInstructor) {
    const { data: profile } = await session.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin' && profile?.role !== 'manager') {
      return { error: NextResponse.json({ error: 'Not your class.' }, { status: 403 }) }
    }
  }
  return { cls, email, instructor, isClassInstructor }
}

/** Recipient lists per audience — paid/completed enrollments, deduped. */
function recipientsFor(cls: any) {
  const parents = new Map<string, string>() // email -> enrollmentId
  const students = new Map<string, string>()
  for (const e of (cls.enrollments as any[]) ?? []) {
    if (e.payment_status !== 'Paid' && e.payment_status !== 'Completed') continue
    const st = one<any>(e.students)
    const fam = one<any>(st?.families)
    if (fam?.parent_email) parents.set(String(fam.parent_email).toLowerCase(), e.id)
    if (st?.student_email) students.set(String(st.student_email).toLowerCase(), e.id)
  }
  return { parents, students }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Copy-emails + recipient counts (spec B3's "low-end convenience"): the
// browser RLS deliberately hides parent emails from instructors, so this
// hands them ONLY their own class's roster addresses.
export async function GET(req: Request) {
  const classId = new URL(req.url).searchParams.get('classId') ?? ''
  if (!classId) return NextResponse.json({ error: 'Missing classId.' }, { status: 400 })
  const auth = await authorizeForClass(classId)
  if ('error' in auth) return auth.error
  const { parents, students } = recipientsFor(auth.cls)
  return NextResponse.json({ parents: [...parents.keys()], students: [...students.keys()] })
}

export async function POST(req: Request) {
  let body: {
    classId?: string
    audience?: 'students' | 'parents' | 'both'
    subject?: string
    message?: string
    ccMe?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const classId = (body.classId ?? '').trim()
  const audience = body.audience ?? 'both'
  const subject = (body.subject ?? '').trim()
  const message = (body.message ?? '').trim()
  if (!classId || !subject || !message) {
    return NextResponse.json({ error: 'Class, subject, and message are required.' }, { status: 400 })
  }

  const auth = await authorizeForClass(classId)
  if ('error' in auth) return auth.error
  const { cls, email, instructor, isClassInstructor } = auth
  const senderName = isClassInstructor
    ? (instructor?.name ?? instructor?.email ?? 'Your instructor')
    : 'Higher Ground Learning'

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const label = `${one<any>(cls.schools as any)?.nickname ?? 'HGL'} ${cls.class_type}`
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const { parents, students } = recipientsFor(cls)
  type Target = { to: string; enrollmentId: string; role: 'parent' | 'student' }
  const targets: Target[] = []
  if (audience === 'parents' || audience === 'both') {
    for (const [to, enrollmentId] of parents) targets.push({ to, enrollmentId, role: 'parent' })
  }
  if (audience === 'students' || audience === 'both') {
    for (const [to, enrollmentId] of students) {
      if (!targets.some((t) => t.to === to)) targets.push({ to, enrollmentId, role: 'student' })
    }
  }
  if (targets.length === 0) {
    return NextResponse.json({ error: 'No recipients for that audience.' }, { status: 400 })
  }

  // "{instructorName} via Higher Ground Learning <info@…>"
  const fromAddress = FROM.match(/<([^>]+)>/)?.[1] ?? FROM
  const from = `${senderName} via Higher Ground Learning <${fromAddress}>`
  const html = wrap(
    `<p style="font-size:13px;color:#64748b;margin-bottom:16px">A message about
      <strong>${escapeHtml(label)}</strong> from ${escapeHtml(senderName)} — you can reply directly.</p>
     ${message.split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('')}`,
    { preheader: `About ${label}`, footer: footerT() }
  )

  const messageId = randomUUID()
  let sent = 0
  const failures: string[] = []
  for (const t of targets) {
    const status = await sendOnce({
      dedupeKey: `instructor_message:${messageId}:${t.to}`,
      emailType: 'instructor_message',
      templateKey: 'IM_INSTRUCTOR_MESSAGE',
      recipientRole: t.role,
      enrollmentId: t.enrollmentId,
      classId,
      senderEmail: email,
      to: [t.to],
      from,
      replyTo: isClassInstructor ? email : undefined,
      subject,
      html,
    })
    if (status === 'sent') sent++
    else failures.push(`${t.to}: ${status}`)
  }

  if (body.ccMe) {
    await sendOnce({
      dedupeKey: `instructor_message:${messageId}:cc:${email}`,
      emailType: 'instructor_message',
      templateKey: 'IM_INSTRUCTOR_MESSAGE',
      recipientRole: 'instructor',
      classId,
      senderEmail: email,
      to: [email],
      from,
      subject: `[copy] ${subject}`,
      html,
    })
  }

  return NextResponse.json({ ok: failures.length === 0, sent, failures, recipients: targets.length })
}
