'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { fmtDay, fmtTime } from './types'

// Recent parent activity (spec v1.4 §8: "nothing happens invisibly") — the
// reschedules families completed THEMSELVES by tapping an offered slot in the
// portal. Each one also fired an Ops Director alert email at pick time; this
// list is the durable record. Staff-executed moves don't appear here — the
// Ops Director did those, so there's nothing to surface.

const ORG_TZ = 'America/Denver'

type PickRow = {
  id: string
  starts_at: string
  parent_rescheduled_at: string
  students: { first_name: string; last_name: string } | null
  tutoring_engagements: { subjects: { name: string } | null } | null
  instructors: { name: string | null } | null
  replacement: { starts_at: string } | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export default function ActivityFeed({ refreshSignal }: { refreshSignal: number }) {
  const [rows, setRows] = useState<PickRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('tutoring_sessions')
        .select(
          `id, starts_at, parent_rescheduled_at,
           students ( first_name, last_name ),
           tutoring_engagements ( subjects ( name ) ),
           instructors ( name ),
           replacement:rescheduled_to_id ( starts_at )`
        )
        .not('parent_rescheduled_at', 'is', null)
        .order('parent_rescheduled_at', { ascending: false })
        .limit(15)
      if (cancelled) return
      setRows(
        ((data as any[]) ?? []).map((r) => ({
          ...r,
          students: one(r.students),
          tutoring_engagements: r.tutoring_engagements
            ? { subjects: one<any>(one<any>(r.tutoring_engagements)?.subjects) }
            : null,
          instructors: one(r.instructors),
          replacement: one(r.replacement),
        })) as PickRow[]
      )
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshSignal])

  if (!loaded) return <p className="text-sm text-gray-500">Loading…</p>
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Nothing yet — when a family moves a session themselves by picking one of the offered times
        in the portal, it shows up here (you get an email at the moment it happens too).
      </p>
    )
  }

  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {rows.map((r) => {
        const student = r.students
        const subj = r.tutoring_engagements?.subjects?.name ?? 'tutoring'
        return (
          <li key={r.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs text-gray-400 w-24 shrink-0">
              {fmtDay(r.parent_rescheduled_at, ORG_TZ)}
            </span>
            <span>
              <strong className="text-hgl-slate">
                {student ? `${student.first_name} ${student.last_name}` : 'Unknown student'}
              </strong>{' '}
              <span className="text-gray-600">({subj}
              {r.instructors?.name ? ` with ${r.instructors.name.split(' ')[0]}` : ''})</span>{' '}
              — family moved{' '}
              <span className="text-gray-600">
                {fmtDay(r.starts_at, ORG_TZ)} {fmtTime(r.starts_at, ORG_TZ)}
              </span>{' '}
              →{' '}
              {r.replacement ? (
                <strong className="text-green-700">
                  {fmtDay(r.replacement.starts_at, ORG_TZ)} {fmtTime(r.replacement.starts_at, ORG_TZ)}
                </strong>
              ) : (
                <span className="text-gray-500">a new time</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
