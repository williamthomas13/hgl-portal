'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { availabilityDiff, rangeLabel, sessionOutsideWindows, type AvailRange } from '../../utils/availability-diff'
import { formatTimeRange, staffTimeCityLabel } from '../../utils/dates'

// PL-424D: the availability-alert click-through lands HERE — a resolution
// surface (standing rule), not a bare record. It shows the SAME old→new diff
// the email carried (from availability_changes — the ONE composer in
// availability-diff.ts) plus what's downstream: any scheduled session or
// proposal now OUTSIDE the new windows, each linking into the PL-387 session
// edit machinery. Nothing auto-changes — staff decides. When nothing
// downstream is affected, it says so plainly.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const ORG_TZ = 'America/Denver'

export default function AvailabilityReviewCard({
  studentId,
  onClose,
}: {
  studentId: string
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [studentName, setStudentName] = useState('')
  const [change, setChange] = useState<any>(null)
  const [windows, setWindows] = useState<AvailRange[]>([])
  const [conflicts, setConflicts] = useState<any[]>([])
  const [futureCount, setFutureCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [{ data: stu }, { data: changes }, { data: avail }, { data: sessions }] = await Promise.all([
        supabase.from('students').select('first_name, last_name, family_id').eq('id', studentId).maybeSingle(),
        supabase
          .from('availability_changes')
          .select('id, kind, before_ranges, after_ranges, timezone, created_at')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('student_availability')
          .select('weekday, start_time, end_time, timezone, source')
          .eq('student_id', studentId),
        supabase
          .from('tutoring_sessions')
          .select('id, starts_at, ends_at, status, tutoring_engagements ( subjects ( name ) )')
          .eq('student_id', studentId)
          .in('status', ['proposed', 'confirmed'])
          .gte('starts_at', new Date().toISOString())
          .order('starts_at'),
      ])
      if (cancelled) return
      const ranges: AvailRange[] = ((avail ?? []) as any[]).map((r) => ({
        weekday: r.weekday,
        start_time: String(r.start_time).slice(0, 5),
        end_time: String(r.end_time).slice(0, 5),
        timezone: r.timezone ?? null,
      }))
      setStudentName(stu ? `${stu.first_name} ${stu.last_name}` : 'This student')
      setChange((changes ?? [])[0] ?? null)
      setWindows(ranges)
      setFutureCount((sessions ?? []).length)
      setConflicts(
        ((sessions ?? []) as any[]).filter((s) => sessionOutsideWindows(s.starts_at, s.ends_at, ranges))
      )
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [studentId])

  if (!loaded) {
    return (
      <div className="bg-white border border-hgl-blue/40 rounded-lg p-4 text-sm text-gray-500">
        Loading the shared-windows review…
      </div>
    )
  }

  const diff = change
    ? availabilityDiff((change.before_ranges ?? []) as AvailRange[], (change.after_ranges ?? []) as AvailRange[])
    : null

  return (
    <div className="bg-white border-2 border-hgl-blue/40 rounded-lg p-4 text-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-bold text-hgl-slate">
          {studentName}&apos;s shared availability
          {change && (
            <span className="text-gray-500 font-normal">
              {' '}
              · {change.kind === 'update' ? 'updated' : 'first shared'}{' '}
              {new Date(change.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </h2>
        <button onClick={onClose} className="text-xs text-gray-500 underline">
          close
        </button>
      </div>

      {diff && change.kind === 'update' ? (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What changed</p>
          <ul className="space-y-0.5">
            {diff.lines.map((l, i) => (
              <li
                key={i}
                className={
                  l.endsWith('ADDED')
                    ? 'text-green-700'
                    : l.endsWith('REMOVED')
                      ? 'text-red-700'
                      : 'text-gray-600'
                }
              >
                {l}
              </li>
            ))}
            {diff.lines.length === 0 && <li className="text-gray-500">saved with no window changes</li>}
          </ul>
        </div>
      ) : (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Shared windows</p>
          {windows.length > 0 ? (
            <p className="text-gray-700">{windows.map((r) => rangeLabel(r)).join(' · ')}</p>
          ) : (
            <p className="text-gray-500">No windows on file.</p>
          )}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Downstream</p>
        {conflicts.length > 0 ? (
          <ul className="space-y-1">
            {conflicts.map((s) => (
              <li key={s.id} className="text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                {new Date(s.starts_at).toLocaleDateString('en-US', { timeZone: ORG_TZ, weekday: 'long', month: 'short', day: 'numeric' })}{' '}
                {formatTimeRange(s.starts_at, s.ends_at, ORG_TZ)} ({staffTimeCityLabel(ORG_TZ)} time)
                {' '}{one<any>(one<any>(s.tutoring_engagements)?.subjects)?.name ?? 'tutoring'} {s.status === 'proposed' ? 'proposal' : 'session'}{' '}
                now falls <strong>outside</strong> the shared availability ·{' '}
                <a href={`/admin/tutoring?session=${s.id}&reschedule=1&why=availability`} className="text-hgl-blue underline font-semibold">
                  review / move it →
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-600">
            {futureCount > 0
              ? `No scheduled sessions conflict with the ${change?.kind === 'update' ? 'new' : 'shared'} windows (${futureCount} upcoming checked).`
              : 'Nothing is scheduled yet — the wizard loads these windows when you build the schedule.'}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1.5">
          Nothing changes automatically — you decide.{' '}
          <a href={`/admin/tutoring?schedule=${studentId}`} className="text-hgl-blue underline">
            open the schedule wizard →
          </a>
        </p>
      </div>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
