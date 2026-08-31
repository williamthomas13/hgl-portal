'use client'

import { formatTimeRange, staffTimeCityLabel } from '../utils/dates'
import type { AssignmentConflict } from '../utils/instructor-conflicts'

// PL-434A (+amendment): the resolve-next list an over-conflicts assignment
// earns — one line per conflicting tutoring session (deduped portal truth),
// each with BOTH doors side by side: "reschedule →" into the PL-387 session
// machinery, and the student's NAME opening the family record (the contact
// facts and recent-activity context a call-first resolution needs). Nothing
// auto-moves — staff decides per session; class sessions win by default
// assumption only.

const ORG_TZ = 'America/Denver'
const fmtWhen = (startIso: string, endIso: string) =>
  `${new Date(startIso).toLocaleDateString('en-US', {
    timeZone: ORG_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })}, ${formatTimeRange(startIso, endIso, ORG_TZ)}`

export default function AssignmentConflicts({
  instructorName,
  conflicts,
  heading,
}: {
  instructorName: string
  conflicts: AssignmentConflict[]
  /** Override the lead line (the NA resolution card supplies its own). */
  heading?: string
}) {
  if (conflicts.length === 0) return null
  const first = instructorName.split(' ')[0]
  return (
    <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-3 text-sm">
      <p className="font-semibold text-amber-900 mb-1.5">
        {heading ??
          `${conflicts.length} tutoring session${conflicts.length === 1 ? '' : 's'} conflict${conflicts.length === 1 ? 's' : ''} with class sessions — reschedule them:`}
      </p>
      <ul className="space-y-1">
        {conflicts.map((c) => (
          <li key={c.sessionId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-gray-700">
              {fmtWhen(c.startsAt, c.endsAt)} ({staffTimeCityLabel(ORG_TZ)} time) — {c.subjectName} with{' '}
              {c.familyId ? (
                <a href={`/admin/families/${c.familyId}`} className="text-hgl-blue underline font-semibold">
                  {c.studentFirst} {c.studentLast}
                </a>
              ) : (
                <span className="font-semibold">
                  {c.studentFirst} {c.studentLast}
                </span>
              )}
            </span>
            <a
              href={`/admin/tutoring?session=${c.sessionId}&reschedule=1`}
              className="text-hgl-blue underline font-semibold"
            >
              reschedule →
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-600 mt-1.5">
        Nothing moves on its own — {first}&apos;s class sessions win by default assumption, but each
        tutoring session is your call (the student&apos;s name opens their family record for the
        call-first context).
      </p>
    </div>
  )
}
