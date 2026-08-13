import { supabaseAdmin as supabase } from './supabase-admin'
import { classDisplayLabel } from './class-label'

// PL-336: nobody should have to remember to update the pipeline on a happy
// ending. The hourly sweep walks every non-terminal lead with a linked
// student (PL-313 linkage) and flips:
//   · → converted ("Enrolled") when the student holds a Paid class
//     enrollment — including leads already marked `lost` (the record should
//     tell the truth), each flip appending a line to the lead's activity
//     feed (leads.notes).
//   · → scheduled ("Started") when the student holds an active 1-on-1
//     engagement — the catch-all behind the existing create/activate flips.
// `scheduled` leads never flip to converted (the tutoring path is its own
// ending), and `converted` is terminal both ways.

export type LeadOutcomeResult = { converted: number; started: number }

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Denver',
  })

export async function sweepLeadOutcomes(): Promise<LeadOutcomeResult> {
  const result: LeadOutcomeResult = { converted: 0, started: 0 }
  const { data: leads } = await supabase
    .from('leads')
    .select('id, status, student_id, notes')
    .not('student_id', 'is', null)
    .neq('status', 'converted')
  const open = (leads as { id: string; status: string; student_id: string; notes: string | null }[]) ?? []
  if (open.length === 0) return result
  const studentIds = [...new Set(open.map((l) => l.student_id))]

  const [{ data: paidEnrollments }, { data: activeEngagements }] = await Promise.all([
    supabase
      .from('enrollments')
      .select(
        `id, student_id, class_id, paid_at, enrolled_at, payment_status,
         classes ( class_type, delivery_mode, fo_short_name, schools ( nickname ) )`
      )
      .in('student_id', studentIds)
      .in('payment_status', ['Paid', 'Completed']),
    supabase
      .from('tutoring_engagements')
      .select('id, student_id')
      .in('student_id', studentIds)
      .eq('status', 'active'),
  ])

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const one = <T,>(v: T | T[] | null | undefined): T | null =>
    v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v
  const paidByStudent = new Map<string, any>()
  for (const e of (paidEnrollments as any[]) ?? []) {
    const when = e.paid_at ?? e.enrolled_at ?? ''
    const prev = paidByStudent.get(e.student_id)
    const prevWhen = prev ? (prev.paid_at ?? prev.enrolled_at ?? '') : ''
    if (!prev || when > prevWhen) paidByStudent.set(e.student_id, e)
  }
  const tutoringStudents = new Set(((activeEngagements as any[]) ?? []).map((e) => e.student_id))
  const nowIso = new Date().toISOString()

  for (const lead of open) {
    const enrollment = lead.status !== 'scheduled' ? paidByStudent.get(lead.student_id) : null
    if (enrollment) {
      const cls = one<any>(enrollment.classes)
      const label = cls
        ? classDisplayLabel({
            schoolNickname: one<any>(cls.schools)?.nickname ?? null,
            deliveryMode: cls.delivery_mode ?? null,
            shortName: cls.fo_short_name ?? null,
            classType: cls.class_type,
          })
        : 'a class'
      const when = enrollment.paid_at ?? enrollment.enrolled_at ?? nowIso
      const chip = `${label}, ${fmtDay(when)}`
      const line =
        lead.status === 'lost'
          ? `This closed lead enrolled anyway — ${label} (${fmtDay(when)}). Reopened as Enrolled.`
          : `Enrolled in ${label} (${fmtDay(when)}) — moved to Enrolled automatically.`
      const { error } = await supabase
        .from('leads')
        .update({
          status: 'converted',
          converted_at: when,
          converted_class_id: enrollment.class_id ?? null,
          converted_label: chip,
          // lost_reason_* stay put on a lost→converted reopen — the whole
          // history is kept; the activity line records the turnaround.
          notes: [lead.notes, line].filter(Boolean).join('\n'),
          updated_at: nowIso,
        })
        .eq('id', lead.id)
        .eq('status', lead.status) // first-writer-wins; a raced row retries next sweep
      if (!error) result.converted++
      continue
    }
    if (
      !['scheduled', 'lost'].includes(lead.status) &&
      tutoringStudents.has(lead.student_id)
    ) {
      const { error } = await supabase
        .from('leads')
        .update({
          status: 'scheduled',
          notes: [lead.notes, '1-on-1 tutoring started — moved to Started automatically.']
            .filter(Boolean)
            .join('\n'),
          updated_at: nowIso,
        })
        .eq('id', lead.id)
        .eq('status', lead.status)
      if (!error) result.started++
    }
  }
  return result
}
