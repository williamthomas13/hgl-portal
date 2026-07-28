import SessionCalendar from '../components/SessionCalendar'
import CopyButton from './copy-button'
import { StatusBadge, ScoresTable, formatDate, one, type ScoreRow } from './shared'
import { summarizeAttendance, type AttendanceRecord } from '../utils/attendance'

// PL-131: the per-class roster card, extracted from counselor-view so the
// tokenized no-login page renders the IDENTICAL surface. One component, one
// set of visibility rules — a counselor reading a digest and a counselor
// logged into the portal must never see two different pictures of the same
// class, and a fix to one can't miss the other.
//
// Nothing here decides WHO may see a class. Both callers scope that
// themselves: the portal by the signed-in counselor's affiliations under
// RLS, the tokenized page by an explicit school+class filter in its query
// (it runs as admin, so the scoping has to be in the query).

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

export default function CounselorClassCard({
c,
withRegLink,
allScores,
base,
}: {
c: any
withRegLink: boolean
allScores: ScoreRow[]
base: string
}) {
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
                  rel="noopener"
                  className="bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:opacity-90 transition"
                >
                  {materialLangs(c).length > 1 ? `${name} (${lang.toUpperCase()})` : name}
                </a>
              ))
            )}
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            <strong>How to share these materials:</strong>{' '}The flyer works well on bulletin
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
              <th className="px-2 py-1.5">Attendance</th>
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
                    <td className="px-2 py-1.5 text-gray-600">
                      {(() => {
                        // Feature B (cross-cutting §3): sessions attended + % —
                        // counselors see attendance for their school's students.
                        const summary = summarizeAttendance(
                          c.sessions ?? [],
                          (e.attendance_records ?? []) as AttendanceRecord[],
                          e.id
                        )
                        if (summary.recordedSessions === 0) return '—'
                        return `${summary.sessionsAttended}/${summary.recordedSessions}${
                          summary.percent != null ? ` · ${summary.percent}%` : ''
                        }`
                      })()}
                    </td>
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
