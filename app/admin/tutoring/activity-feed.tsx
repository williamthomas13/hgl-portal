'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { fmtDay, fmtTime } from './types'

// Recent parent activity (spec v1.4 §8: "nothing happens invisibly") — one
// merged feed of everything families did from the portal:
//   · self-service reschedules (they tapped an offered slot — completed)
//   · PL-319: reschedule REQUESTS that need staff action, each with its
//     status and, while pending, a link straight to the PL-297
//     approve-or-propose surface. Handled requests show what happened.
// Staff-executed moves still don't appear — the Ops Director did those.

const ORG_TZ = 'America/Denver'

type SessionRefs = {
  students: { first_name: string; last_name: string } | null
  tutoring_engagements: { subjects: { name: string } | null } | null
  instructors: { name: string | null } | null
}

type FeedItem = SessionRefs & {
  key: string
  /** Sort/display timestamp — when the family acted. */
  at: string
  kind: 'moved' | 'requested'
  sessionId: string
  starts_at: string
  status: string
  note: string | null
  replacement: { starts_at: string } | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const refs = (r: any): SessionRefs => ({
  students: one(r.students),
  tutoring_engagements: r.tutoring_engagements
    ? { subjects: one<any>(one<any>(r.tutoring_engagements)?.subjects) }
    : null,
  instructors: one(r.instructors),
})

export default function ActivityFeed({ refreshSignal }: { refreshSignal: number }) {
  const [rows, setRows] = useState<FeedItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sel = `id, starts_at, status, parent_rescheduled_at, reschedule_requested_at, reschedule_request_note,
           students ( first_name, last_name ),
           tutoring_engagements ( subjects ( name ) ),
           instructors ( name ),
           replacement:rescheduled_to_id ( starts_at )`
      const [picks, requests] = await Promise.all([
        supabase
          .from('tutoring_sessions')
          .select(sel)
          .not('parent_rescheduled_at', 'is', null)
          .order('parent_rescheduled_at', { ascending: false })
          .limit(15),
        supabase
          .from('tutoring_sessions')
          .select(sel)
          .not('reschedule_requested_at', 'is', null)
          .order('reschedule_requested_at', { ascending: false })
          .limit(15),
      ])
      if (cancelled) return
      const items: FeedItem[] = []
      for (const r of (picks.data as any[]) ?? []) {
        items.push({
          ...refs(r),
          key: `pick-${r.id}`,
          at: r.parent_rescheduled_at,
          kind: 'moved',
          sessionId: r.id,
          starts_at: r.starts_at,
          status: r.status,
          note: null,
          replacement: one(r.replacement),
        })
      }
      for (const r of (requests.data as any[]) ?? []) {
        // A session can carry both stamps (asked first, then self-served) —
        // both stories are real; each shows under its own timestamp.
        items.push({
          ...refs(r),
          key: `req-${r.id}`,
          at: r.reschedule_requested_at,
          kind: 'requested',
          sessionId: r.id,
          starts_at: r.starts_at,
          status: r.status,
          note: r.reschedule_request_note ?? null,
          replacement: one(r.replacement),
        })
      }
      items.sort((a, b) => (a.at < b.at ? 1 : -1))
      setRows(items.slice(0, 20))
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
        Nothing yet — when a family moves a session themselves, or asks you to move one, it shows
        up here (you get an email at the moment it happens too).
      </p>
    )
  }

  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {rows.map((r) => {
        const student = r.students
        const subj = r.tutoring_engagements?.subjects?.name ?? 'tutoring'
        const who = student ? `${student.first_name} ${student.last_name}` : 'Unknown student'
        const withTutor = r.instructors?.name ? ` with ${r.instructors.name.split(' ')[0]}` : ''
        // PL-319 pending rule (same as the dashboard's): the request stands
        // while the session is still a future confirmed one.
        const pending =
          r.kind === 'requested' &&
          r.status === 'confirmed' &&
          new Date(r.starts_at).getTime() > Date.now()
        return (
          <li key={r.key} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs text-gray-400 w-24 shrink-0">{fmtDay(r.at, ORG_TZ)}</span>
            <span>
              <strong className="text-hgl-slate">{who}</strong>{' '}
              <span className="text-gray-600">({subj}{withTutor})</span>{' '}
              {r.kind === 'moved' ? (
                <>
                  — family moved{' '}
                  <span className="text-gray-600">
                    {fmtDay(r.starts_at, ORG_TZ)} {fmtTime(r.starts_at, ORG_TZ)}
                  </span>{' '}
                  →{' '}
                  {r.replacement ? (
                    <strong className="text-green-700">
                      {fmtDay(r.replacement.starts_at, ORG_TZ)}{' '}
                      {fmtTime(r.replacement.starts_at, ORG_TZ)}
                    </strong>
                  ) : (
                    <span className="text-gray-500">a new time</span>
                  )}
                </>
              ) : (
                <>
                  — family ASKED to move the{' '}
                  <span className="text-gray-600">
                    {fmtDay(r.starts_at, ORG_TZ)} {fmtTime(r.starts_at, ORG_TZ)}
                  </span>{' '}
                  session{r.note ? <span className="text-gray-500"> — “{r.note}”</span> : ''}{' '}
                  {pending ? (
                    <>
                      <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 font-semibold">
                        waiting on you
                      </span>{' '}
                      <a
                        href={`/admin/tutoring?session=${r.sessionId}&reschedule=1`}
                        className="text-hgl-blue underline font-semibold"
                      >
                        approve or propose →
                      </a>
                    </>
                  ) : r.status === 'rescheduled' && r.replacement ? (
                    <span className="text-green-700">
                      → moved to {fmtDay(r.replacement.starts_at, ORG_TZ)}{' '}
                      {fmtTime(r.replacement.starts_at, ORG_TZ)}
                    </span>
                  ) : r.status === 'rescheduled' ? (
                    <span className="text-green-700">→ rescheduled</span>
                  ) : r.status === 'forfeited' || r.status === 'no_show' ? (
                    <span className="text-gray-500">→ session {r.status === 'no_show' ? 'marked a no-show' : 'forfeited'}</span>
                  ) : (
                    <span className="text-gray-500">→ handled (session went ahead or passed)</span>
                  )}
                </>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
