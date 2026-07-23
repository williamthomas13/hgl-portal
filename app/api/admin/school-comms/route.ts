import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { templateLabel } from '../../../utils/comms'
import { classroomChaseLine } from '../../../utils/classroom-chase'

// PL-93: "are our nudges landing?" — the PL-83 timeline machinery scoped to
// a school's contact emails, with per-row delivered/opened status. Also
// serves the CR chase line (open state included) for the class-card badge.
// Honesty rule: opens are pixel-based and directional — raw per-row status,
// no editorializing; the reliable pattern is the all-unopened contact.

/* eslint-disable @typescript-eslint/no-explicit-any */

function stateFor(r: any): string {
  if (r.status === 'cancelled') return 'cancelled'
  if (r.status === 'scheduled') return 'upcoming'
  if (r.status === 'held') return 'held'
  if (r.status === 'failed') return 'failed'
  if (r.status === 'bounced' || r.status === 'complained') return 'bounced'
  if (r.first_opened_at) return 'opened'
  if (r.delivered_at || r.status === 'delivered') return 'delivered'
  return 'sent'
}

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(req.url)

  // Mode 2: the CR chase line for a class (PL-89 util — opens included).
  const chaseClassId = url.searchParams.get('chaseClassId')
  if (chaseClassId) {
    return NextResponse.json({ line: await classroomChaseLine(chaseClassId) })
  }

  const schoolId = url.searchParams.get('schoolId')
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase()
  if (!schoolId) return NextResponse.json({ error: 'Missing schoolId.' }, { status: 400 })

  const { data: affiliations } = await supabase
    .from('school_affiliations')
    .select('contacts ( email )')
    .eq('school_id', schoolId)
  const emails = [
    ...new Set(
      ((affiliations as any[]) ?? [])
        .map((a) => (Array.isArray(a.contacts) ? a.contacts[0] : a.contacts)?.email?.toLowerCase())
        .filter(Boolean)
    ),
  ] as string[]
  const scope = email ? emails.filter((e) => e === email) : emails
  if (scope.length === 0) return NextResponse.json({ items: [] })

  const { data: rows } = await supabase
    .from('email_sends')
    .select(
      'id, template_key, recipient_email, sender_email, manually_rescheduled, is_test, status, sent_at, scheduled_for, delivered_at, first_opened_at, subject_rendered'
    )
    .in('recipient_email', scope)
    .eq('recipient_role', 'counselor')

  const items = ((rows as any[]) ?? [])
    .map((r) => ({
      id: r.id,
      label: templateLabel(r.template_key),
      subject: r.subject_rendered ?? null,
      recipient: r.recipient_email,
      state: stateFor(r),
      origin: r.is_test ? 'test' : r.sender_email || r.manually_rescheduled ? 'by hand' : 'automatic',
      when: r.sent_at ?? r.scheduled_for ?? null,
    }))
    .sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''))

  return NextResponse.json({ items })
}
