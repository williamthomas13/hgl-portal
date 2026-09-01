'use client'

import { useEffect, useState } from 'react'
import AssignmentConflicts from '../assignment-conflicts'
import type { AssignmentConflict } from '../../utils/instructor-conflicts'

// PL-434B: the Needs Attention row's resolution surface — the SAME conflict
// list the assignment confirmation showed, recomputed from reality on every
// open (so a session moved/cancelled through ANY path is already gone from
// it), with the amendment's two doors per line. Zero conflicts left = the
// honest all-clear (the dashboard row has self-cleared by the same math).

export default function AssignmentConflictsCard({
  classId,
  onClose,
}: {
  classId: string
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [classLabel, setClassLabel] = useState('')
  const [instructorName, setInstructorName] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<AssignmentConflict[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/assignment-conflicts?classId=${classId}`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) setError(json.error ?? `The server returned ${res.status}.`)
        else {
          setClassLabel(json.classLabel ?? '')
          setInstructorName(json.instructorName ?? null)
          setConflicts(json.conflicts ?? [])
        }
      } catch {
        if (!cancelled) setError("Couldn't reach the server.")
      }
      if (!cancelled) setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [classId])

  return (
    <div className="bg-white border-2 border-amber-300 rounded-lg p-4 text-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-bold text-hgl-slate">
          {classLabel || 'Class'} — assignment conflicts
          {instructorName && <span className="text-gray-500 font-normal"> · {instructorName}</span>}
        </h2>
        <button onClick={onClose} className="text-xs text-gray-500 underline">
          close
        </button>
      </div>
      {!loaded ? (
        <p className="text-gray-500">Checking the schedule…</p>
      ) : error ? (
        <p className="text-red-700 font-semibold">{error}</p>
      ) : instructorName === null ? (
        <p className="text-gray-600">This class has no instructor assigned — nothing can conflict.</p>
      ) : conflicts.length === 0 ? (
        <p className="text-green-700">
          All clear — no tutoring sessions conflict with {classLabel}&apos;s class sessions anymore.
        </p>
      ) : (
        <AssignmentConflicts
          originClassId={classId}
          instructorName={instructorName}
          conflicts={conflicts}
          heading={`${instructorName.split(' ')[0]}'s class assignment conflicts with ${conflicts.length} tutoring session${conflicts.length === 1 ? '' : 's'} — reschedule them:`}
        />
      )}
    </div>
  )
}
