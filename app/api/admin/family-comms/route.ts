import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { templateLabel } from '../../../utils/comms'

// PL-83: Kelsie's "what have they been told?" — every email a family has
// received or will receive, in one family-scoped timeline on the admin
// family/student record. Reuses the PL-77 machinery (email_sends holds both
// history and the projector's scheduled rows; the comms-preview endpoint
// opens the exact render). Each row is badged by ORIGIN — automatic
// (sequence/cron/webhook) vs sent-by-hand (a human wrote it or pushed
// send-now/rescheduled it) vs test — so it's visible at a glance which
// communications the system handled and which a human did.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FamilyCommsItem = {
  id: string
  label: string
  subject: string | null
  recipient: string
  recipientRole: string
  state: 'upcoming' | 'held' | 'sent' | 'delivered' | 'opened' | 'bounced' | 'cancelled' | 'failed'
  origin: 'automatic' | 'by hand' | 'test'
  when: string | null // ISO
}

function stateFor(r: any): FamilyCommsItem['state'] {
  if (r.status === 'cancelled') return 'cancelled'
  if (r.status === 'scheduled') return 'upcoming'
  if (r.status === 'held') return 'held'
  if (r.status === 'failed') return 'failed'
  if (r.status === 'bounced' || r.status === 'complained') return 'bounced'
  if (r.first_opened_at) return 'opened'
  if (r.delivered_at || r.status === 'delivered') return 'delivered'
  return 'sent'
}

function originFor(r: any): FamilyCommsItem['origin'] {
  if (r.is_test) return 'test'
  // A human either wrote it (compose panel stamps sender_email) or decided
  // its send moment (send-now / manual reschedule on the comms dashboard).
  if (r.sender_email || r.manually_rescheduled) return 'by hand'
  return 'automatic'
}

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const url = new URL(req.url)
  let familyId = url.searchParams.get('familyId')
  const studentId = url.searchParams.get('studentId')

  if (!familyId && studentId) {
    const { data: student } = await supabase
      .from('students')
      .select('family_id')
      .eq('id', studentId)
      .maybeSingle()
    familyId = student?.family_id ?? null
  }
  if (!familyId) return NextResponse.json({ error: 'No family found.' }, { status: 404 })

  const { data: family } = await supabase
    .from('families')
    .select(
      `id, parent_first_name, parent_last_name, parent_email, billing_email, billing_cc_emails,
       students ( id, first_name, last_name, student_email )`
    )
    .eq('id', familyId)
    .maybeSingle()
  if (!family) return NextResponse.json({ error: 'Family not found.' }, { status: 404 })

  const students: any[] = (family.students as any[]) ?? []
  const emails = [
    family.parent_email,
    family.billing_email,
    ...((family.billing_cc_emails as string[] | null) ?? []),
    ...students.map((s) => s.student_email),
  ]
    .filter(Boolean)
    .map((e: string) => e.toLowerCase())

  const { data: enrollments } = students.length
    ? await supabase
        .from('enrollments')
        .select('id')
        .in('student_id', students.map((s) => s.id))
    : { data: [] as any[] }
  const enrollmentIds = (enrollments ?? []).map((e: any) => e.id)

  const COLS =
    'id, dedupe_key, template_key, enrollment_id, class_id, recipient_email, recipient_role, sender_email, manually_rescheduled, is_test, status, sent_at, scheduled_for, delivered_at, first_opened_at, subject_rendered'
  const [byEnrollment, byAddress] = await Promise.all([
    enrollmentIds.length
      ? supabase
          .from('email_sends')
          .select(COLS)
          .in('enrollment_id', enrollmentIds)
          .in('recipient_role', ['parent', 'student'])
      : Promise.resolve({ data: [] as any[] }),
    // Parent- and student-addressed only (the doc's scope) — without the
    // role filter, QA families whose parent email doubles as the admin's
    // pulled admin alerts and counselor emails into the timeline.
    emails.length
      ? supabase
          .from('email_sends')
          .select(COLS)
          .in('recipient_email', emails)
          .in('recipient_role', ['parent', 'student'])
      : Promise.resolve({ data: [] as any[] }),
  ])

  const rows = new Map<string, any>()
  for (const r of [...(byEnrollment.data ?? []), ...(byAddress.data ?? [])]) rows.set(r.id, r)

  const items: FamilyCommsItem[] = [...rows.values()]
    .map((r) => ({
      id: r.id,
      label: templateLabel(r.template_key),
      subject: r.subject_rendered ?? null,
      recipient: r.recipient_email,
      recipientRole: r.recipient_role ?? '—',
      state: stateFor(r),
      origin: originFor(r),
      when: r.sent_at ?? r.scheduled_for ?? null,
    }))
    .sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''))

  return NextResponse.json({
    familyLabel: `${family.parent_first_name ?? ''} ${family.parent_last_name ?? ''}`.trim() || family.parent_email,
    items,
  })
}
