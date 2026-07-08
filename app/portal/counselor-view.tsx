import type { SupabaseClient } from '@supabase/supabase-js'
import SessionCalendar from '../components/SessionCalendar'
import CopyButton from './copy-button'
import { StatusBadge, ScoresTable, formatDate, one, type ScoreRow } from './shared'

// Counselor view (PHASE4_SPEC §4): the school's open/upcoming classes with
// paid/capacity, waitlist depth, and the registration link; a roster per
// class with status, scores, and accommodations. Deliberately NOT selected or
// shown: parent contact details (RLS also blocks the families table for
// counselors), payment amounts, and registration notes.

/* eslint-disable @typescript-eslint/no-explicit-any */

function gradeOf(st: any): string {
  if (st?.grade_level) return `Grade ${st.grade_level}`
  if (st?.graduating_year) return `Class of ${st.graduating_year}`
  return '—'
}

/** Effective collateral language(s): class override, else school default. */
function materialLangs(c: any): ('en' | 'es')[] {
  const setting = c.collateral_language ?? one<any>(c.schools)?.collateral_language ?? 'en'
  return setting === 'both' ? ['en', 'es'] : [setting === 'es' ? 'es' : 'en']
}

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
    .ilike('contacts.email', email)

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
      default_location, school_id, collateral_language,
      schools ( name, nickname, collateral_language ),
      instructors ( name, email ),
      sessions ( session_date, start_time, end_time, location ),
      enrollments (
        id, payment_status, enrolled_at, accommodations, waitlist_offer_expires_at,
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
    const sessions = [...(c.sessions ?? [])].sort((a: any, b: any) =>
      a.session_date.localeCompare(b.session_date)
    )
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

  function roster(c: any, withRegLink: boolean) {
    const label = `${one<any>(c.schools)?.nickname ?? 'HGL'} ${c.class_type}`
    const regLink = `${base}/register/${c.slug ?? c.id}`
    const active = (c.enrollments ?? []).filter(
      (e: any) => e.payment_status !== 'Expired' && e.payment_status !== 'Refunded'
    )
    return (
      <div key={c.id} className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div>
            <h3 className="font-bold text-hgl-slate text-lg">
              {label}
              {c.status === 'cancelled' && (
                <span className="ml-2 align-middle inline-block px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded uppercase tracking-wide">
                  Cancelled
                </span>
              )}
            </h3>
            <p className="text-sm text-gray-600">
              Starts {formatDate(c.firstSession)} · ${Number(c.price).toLocaleString()} per student
              {` · ${one<any>(c.instructors)?.name ?? one<any>(c.instructors)?.email ?? 'instructor to be announced'}`}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-hgl-slate">
              {c.paid} <span className="text-gray-400 font-normal">/ {c.capacity} paid</span>
            </div>
            {c.waitlist > 0 && (
              <div className="text-xs text-purple-700 font-semibold">
                waitlist: {c.waitlist}
              </div>
            )}
          </div>
        </div>

        {withRegLink && (
          <div className="flex items-center gap-2 mb-3 bg-gray-50 border border-gray-200 rounded p-2 text-sm">
            <span className="text-gray-600 truncate">{regLink}</span>
            <CopyButton text={regLink} />
          </div>
        )}

        {/* Phase 4.5: flyer + parent letter downloads (spec §8). Rendered live
            from class data, so they can never be stale. */}
        {withRegLink && (
          <div className="mb-4 border border-gray-200 rounded p-3">
            <h4 className="text-sm font-bold text-hgl-slate mb-2">Class materials</h4>
            <div className="flex flex-wrap gap-2 mb-2">
              {materialLangs(c).map((lang) =>
                (
                  [
                    ['flyer.pdf', 'Flyer PDF'],
                    ['flyer.jpg', 'Flyer JPG'],
                    ['letter.pdf', 'Parent letter PDF'],
                    ['letter.jpg', 'Parent letter JPG'],
                  ] as const
                ).map(([artifact, name]) => (
                  <a
                    key={artifact + lang}
                    href={`/api/classes/${c.id}/collateral/${artifact}?lang=${lang}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:opacity-90 transition"
                  >
                    {materialLangs(c).length > 1 ? `${name} (${lang.toUpperCase()})` : name}
                  </a>
                ))
              )}
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              <strong>How to share these materials:</strong> The flyer works well on bulletin
              boards, hallway screens, and in student newsletters (use the JPG for screens and
              digital, the PDF for printing). The letter is written for parents — forward it in
              your parent communications or print it for distribution. Both always reflect the
              latest class details, so if the schedule changes, please re-download rather than
              reusing saved copies.
            </p>
          </div>
        )}

        {c.sessions.length > 0 && (
          <details className="mb-3">
            <summary className="text-sm font-semibold text-hgl-blue cursor-pointer">
              Session calendar ({c.sessions.length} sessions)
            </summary>
            <div className="mt-2">
              <SessionCalendar sessions={c.sessions} defaultLocation={c.default_location} />
            </div>
          </details>
        )}

        {active.length > 0 ? (
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-2 py-1.5">Student</th>
                <th className="px-2 py-1.5">Grade</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Accommodations</th>
              </tr>
            </thead>
            <tbody>
              {active
                .sort((a: any, b: any) =>
                  (one<any>(a.students)?.last_name ?? '').localeCompare(one<any>(b.students)?.last_name ?? '')
                )
                .map((e: any) => {
                  const st = one<any>(e.students)
                  return (
                    <tr key={e.id} className="border-t border-gray-100 align-top">
                      <td className="px-2 py-1.5 font-semibold text-hgl-slate">
                        {st ? `${st.first_name} ${st.last_name}` : '—'}
                        {st && (
                          <ScoresTable
                            scores={(allScores ?? []).filter(
                              (s: any) => s.student_id === st.id && (!s.class_id || s.class_id === c.id)
                            )}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">{gradeOf(st)}</td>
                      <td className="px-2 py-1.5"><StatusBadge status={e.payment_status} /></td>
                      <td className="px-2 py-1.5 text-gray-600">{e.accommodations || '—'}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">No registrations yet.</p>
        )}
      </div>
    )
  }

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
          {openClasses.map((c) => roster(c, true))}
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
          <div className="mt-3 space-y-6">{pastClasses.map((c) => roster(c, false))}</div>
        </details>
      )}
    </div>
  )
}
