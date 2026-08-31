import type { SupabaseClient } from '@supabase/supabase-js'
import CounselorClassCard from './counselor-class-card'
import { one, type ScoreRow } from './shared'
import { bySessionStart } from '../utils/dates'
import { escapeLike } from '../utils/like-escape'

// Counselor view (PHASE4_SPEC §4): the school's open/upcoming classes with
// paid/capacity, waitlist depth, and the registration link; a roster per
// class with status, scores, and accommodations. Deliberately NOT selected or
// shown: parent contact details (RLS also blocks the families table for
// counselors), payment amounts, and registration notes.

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function CounselorView({
  supabase,
  email,
}: {
  supabase: SupabaseClient
  email: string
}) {
  // Active affiliations only, filtered by own email — staff can read every
  // affiliation under RLS, so the explicit filter keeps their view scoped.
  const { data: affiliationRows } = await supabase
    .from('school_affiliations')
    .select('id, school_id, contacts!inner(email), schools ( id, name, nickname )')
    .is('ended_at', null)
    .ilike('contacts.email', escapeLike(email))

  const schoolIds = (affiliationRows ?? []).map((c: any) => c.school_id)
  if (schoolIds.length === 0) {
    return <p className="text-gray-500 bg-white rounded-lg border p-6">No school found for your account.</p>
  }

  const { data: classes } = await supabase
    .from('classes')
    .select(
      `
      id, slug, status, class_type, delivery_mode, price, capacity,
      start_date, registration_close_date, enrollment_deadline,
      default_location, school_id, collateral_language, timezone, display_cities, short_link,
      schools ( name, nickname, collateral_language, timezone, city, evergreen_code ),
      instructors ( name, email ),
      sessions ( id, session_date, start_time, end_time, location ),
      enrollments (
        id, payment_status, enrolled_at, accommodations, waitlist_offer_expires_at,
        attendance_records ( session_id, enrollment_id, present, arrived_late, left_early, minutes_late, minutes_left_early ),
        students ( id, first_name, last_name, grade_level, graduating_year )
      )
    `
    )
    .in('school_id', schoolIds)
    .order('start_date', { ascending: false })

  const studentIds = new Set<string>()
  for (const c of classes ?? []) {
    for (const e of (c as any).enrollments ?? []) {
      const st = one<any>(e.students)
      if (st) studentIds.add(st.id)
    }
  }
  const { data: allScores } = studentIds.size
    ? await supabase
        .from('student_scores')
        .select('id, student_id, class_id, test_label, section_scores, total, taken_at')
        .in('student_id', [...studentIds])
    : { data: [] as ScoreRow[] }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const today = new Date().toLocaleDateString('en-CA')

  const decorated = (classes ?? []).map((c: any) => {
    const sessions = [...(c.sessions ?? [])].sort(bySessionStart)
    const firstSession = sessions[0]?.session_date ?? c.start_date
    const registrationClose = c.registration_close_date ?? firstSession
    const enrollments = c.enrollments ?? []
    const paid = enrollments.filter(
      (e: any) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
    ).length
    const waitlist = enrollments.filter((e: any) => e.payment_status === 'Waitlisted').length
    return {
      ...c,
      sessions,
      firstSession,
      registrationClose,
      paid,
      waitlist,
      isOpen: c.status !== 'cancelled' && today <= registrationClose,
    }
  })

  const openClasses = decorated.filter((c) => c.isOpen)
  const pastClasses = decorated.filter((c) => !c.isOpen)

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-hgl-slate">
        {(affiliationRows ?? [])
          .map((c: any) => one<any>(c.schools)?.name)
          .filter(Boolean)
          .join(' · ')}
      </h2>

      {openClasses.length > 0 ? (
        <>
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">
            Open &amp; upcoming classes
          </h3>
          {openClasses.map((c) => (
            <CounselorClassCard key={c.id} c={c} withRegLink allScores={(allScores ?? []) as ScoreRow[]} base={base} />
          ))}
        </>
      ) : (
        <p className="text-gray-500 bg-white rounded-lg border p-6">
          No open classes at your school right now.
        </p>
      )}

      {pastClasses.length > 0 && (
        <details>
          <summary className="text-sm font-bold text-gray-500 uppercase tracking-wide cursor-pointer">
            Past classes ({pastClasses.length})
          </summary>
          <div className="mt-3 space-y-6">{pastClasses.map((c) => (
              <CounselorClassCard key={c.id} c={c} withRegLink={false} allScores={(allScores ?? []) as ScoreRow[]} base={base} />
            ))}</div>
        </details>
      )}
    </div>
  )
}
