'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVisibleInterval } from '../components/use-visible-interval'
import { SystemHealthBody, type SystemHealth } from './system-health-card'

// PL-100: the landing dashboard. Needs Attention mirrors the alert family
// but is STATE-DRIVEN — the API recomputes every row from live state, and
// this panel refetches on a light interval, so resolving a condition from
// ANY path (email link, record page, portal) clears its row here without
// anyone touching the dashboard. Recent Activity is read-only.

type AttentionRow = {
  id: string
  kind: string
  text: string
  href: string
  urgent?: boolean
  /** PL-135: when the condition started (the record's own timestamp). */
  since?: string
  /** PL-135: a promised date — beats the age wherever both exist. */
  deadline?: string
  /** PL-133: a human-pinned note rather than a derived condition. */
  manual?: { by: string; at: string }
  /** PL-207: one-click push onto the pinned notes. */
  quickNote?: { label: string; body: string }
}
type ActivityRow = {
  id: string
  when: string
  text: string
  href: string
  type?: string
  groupKey?: string
  groupLabel?: string
}

// PL-134: same day + same type + same target collapses to one expandable
// row — "3 registrations for ISD SAT Prep" instead of three near-identical
// lines. The day boundary is LOCAL, not UTC (the audit's dashboard note):
// bucketing on the ISO string would split an evening's registrations across
// two days.
function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

type FeedGroup = { key: string; rows: ActivityRow[] }

function groupActivity(rows: ActivityRow[]): FeedGroup[] {
  const groups: FeedGroup[] = []
  const index = new Map<string, FeedGroup>()
  for (const r of rows) {
    // A row with no groupKey is always its own row.
    const key = r.groupKey ? `${localDay(r.when)}|${r.groupKey}` : `solo|${r.id}`
    const existing = index.get(key)
    if (existing) existing.rows.push(r)
    else {
      const g = { key, rows: [r] }
      index.set(key, g)
      groups.push(g)
    }
  }
  return groups
}

// PL-135: "waiting 3 days" — from the condition's own start, never from when
// the dashboard first noticed. Local day math (the audit's F/dashboard note).
function ageLabel(iso: string): string | null {
  const start = new Date(iso)
  if (Number.isNaN(start.getTime())) return null
  const day = (d: Date) => Date.parse(d.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }))
  const days = Math.round((day(new Date()) - day(start)) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'waiting 1 day'
  if (days < 30) return `waiting ${days} days`
  const months = Math.round(days / 30)
  return `waiting ${months} month${months === 1 ? '' : 's'}`
}

// PL-133: "if a note references a record, the person can paste a portal link
// and it should render clickable — that's the whole feature."
function linkify(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/\S+)/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        className="text-hgl-blue underline break-all"
        target={part.includes(typeof window === 'undefined' ? '' : window.location.host) ? undefined : '_blank'}
        rel="noopener noreferrer"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

// PL-135/127: a promised date shows its countdown instead of an age.
function deadlineLabel(iso: string): string {
  const day = (d: Date) => Date.parse(d.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }))
  const days = Math.round((day(new Date(iso)) - day(new Date())) / 86400000)
  if (days === 0) return 'due today'
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`
  return `${-days} day${days === -1 ? '' : 's'} overdue`
}
type UpcomingClass = {
  id: string
  label: string
  startDate: string
  paid: number
  min: number | null
  href: string
}

export default function DashboardPanel({
  simulatedManager = false,
}: {
  /** PL-331: render the manager variant (no System health card) regardless
   *  of the caller's real role — used by the view-as manager simulation. */
  simulatedManager?: boolean
} = {}) {
  const [attention, setAttention] = useState<AttentionRow[] | null>(null)
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [upcoming, setUpcoming] = useState<UpcomingClass[]>([])
  const [weekSessions, setWeekSessions] = useState(0)
  const [weekProposed, setWeekProposed] = useState(0)
  const [error, setError] = useState('')
  const [health, setHealth] = useState<SystemHealth | null>(null)
  // PL-331: the API reports the caller's role — managers get no System
  // health card here (the same numbers live under Settings → System health).
  const [role, setRole] = useState<'admin' | 'manager'>('admin')
  // PL-134: client-side only, defaults to All, no persistence needed.
  const [activityFilter, setActivityFilter] = useState('All')
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])

  // PL-153c: a failed load must SAY so and offer a retry. This is the admin
  // landing page — leaving "Checking every condition…" pulsing forever reads
  // as "nothing needs attention", which is the one thing it must never imply.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dashboard')
      if (!res.ok) {
        setError(`Could not load the dashboard (the server returned ${res.status}).`)
        return
      }
      const json = await res.json().catch(() => null)
      if (!json) {
        setError('Could not load the dashboard — the response was unreadable.')
        return
      }
      setAttention(json.attention ?? [])
      setActivity(json.activity ?? [])
      setUpcoming(json.upcoming ?? [])
      setWeekSessions(json.weekSessions ?? 0)
      setWeekProposed(json.weekProposed ?? 0)
      setHealth(json.health ?? null)
      setRole(json.role === 'manager' ? 'manager' : 'admin')
      setError('')
    } catch {
      setError("Could not reach the server — check your connection.")
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])
  // PL-152: the refresh only runs while the dashboard section is on screen.
  const panelRef = useRef<HTMLDivElement | null>(null)
  useVisibleInterval(panelRef, load, 60000) // rows clear as conditions resolve anywhere

  // PL-133: add + clear. Deliberately the only two verbs this feature has.
  const [noteDraft, setNoteDraft] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)

  const noteAction = useCallback(
    async (payload: Record<string, unknown>) => {
      setNoteBusy(true)
      try {
        const res = await fetch('/api/admin/dashboard-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) setError(json.error ?? 'That note action failed.')
        else await load()
        return res.ok
      } catch {
        setError("Couldn't reach the server — the note wasn't saved.")
        return false
      } finally {
        setNoteBusy(false)
      }
    },
    [load]
  )

  async function addNote() {
    if (!noteDraft.trim()) return
    if (await noteAction({ action: 'add', body: noteDraft })) setNoteDraft('')
  }
  const clearNote = (id: string) => noteAction({ action: 'clear', id })

  const activityTypes = [...new Set(activity.map((r) => r.type).filter(Boolean))] as string[]
  const visibleActivity =
    activityFilter === 'All' ? activity : activity.filter((r) => r.type === activityFilter)

  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start" ref={panelRef}>
      {/* PL-205: the left column tells the whole story on one screen —
          attention first, then what's coming (Upcoming classes + This week's
          tutoring moved up from the page bottom, where they were invisible
          without scrolling). */}
      <div className="space-y-6">
      {/* Needs Attention — the star */}
      <div className="bg-white rounded-lg shadow-md border-t-4 border-amber-500 p-5">
        <h2 className="text-lg font-bold text-hgl-slate mb-1">
          Needs attention
          {attention !== null && attention.length > 0 && (
            <span className="ml-2 text-xs font-semibold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
              {attention.length}
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Live conditions, not sent emails — fixing something anywhere clears its row here.
        </p>
        {error ? (
          <div className="text-sm">
            <p className="text-red-600">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-2 font-semibold text-hgl-blue underline hover:text-hgl-slate"
            >
              Try again
            </button>
          </div>
        ) : attention === null ? (
          <p className="text-sm text-gray-400 animate-pulse">Checking every condition…</p>
        ) : attention.length === 0 ? (
          <p className="text-sm text-green-700">✓ Nothing needs attention right now.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {attention.map((r) => {
              // PL-135: a promised deadline beats an age; manual notes show
              // when they were pinned and never get aging styling.
              const clock = r.manual
                ? `added ${new Date(r.manual.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : r.deadline
                  ? deadlineLabel(r.deadline)
                  : r.since
                    ? ageLabel(r.since)
                    : null
              const inner = (
                <>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={`text-[10px] uppercase tracking-wide font-bold ${
                        r.manual ? 'text-gray-500' : r.urgent ? 'text-red-700' : 'text-amber-700'
                      }`}
                    >
                      {/* PL-133: a note is tagged so nobody reads it as a
                          system condition. */}
                      {r.manual ? '📌 Note' : r.kind}
                    </span>
                    {clock && (
                      <span
                        className={`text-[10px] ${
                          r.manual ? 'text-gray-400' : r.urgent ? 'text-red-600 font-semibold' : 'text-gray-500'
                        }`}
                      >
                        {clock}
                      </span>
                    )}
                  </span>
                  <span className="block text-gray-700 whitespace-pre-line">{linkify(r.text)}</span>
                  {r.manual && (
                    <span className="block text-[10px] text-gray-400 mt-0.5">{r.manual.by}</span>
                  )}
                </>
              )
              return (
                <li key={r.id} className="py-2">
                  {r.manual ? (
                    <div className="flex items-start gap-2">
                      <div className="flex-1">{inner}</div>
                      <button
                        type="button"
                        onClick={() => clearNote(r.id.replace(/^note-/, ''))}
                        className="text-[11px] font-semibold text-hgl-blue underline hover:text-hgl-slate shrink-0 mt-0.5"
                      >
                        done
                      </button>
                    </div>
                  ) : r.id.startsWith('missed-call-') ? (
                    /* PL-202: missed calls clear on an outbound call — or
                       this manual dismiss ("handled it another way"). */
                    <div className="flex items-start gap-2">
                      <a href={r.href} className="flex-1 block group hover:[&_span]:text-hgl-blue">
                        {inner}
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch('/api/admin/calls', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'dismiss_missed', id: r.id }),
                          })
                          load()
                        }}
                        className="text-[11px] font-semibold text-hgl-blue underline hover:text-hgl-slate shrink-0 mt-0.5"
                        title="Handled — clear without logging a call"
                      >
                        handled
                      </button>
                    </div>
                  ) : r.quickNote ? (
                    /* PL-207: the wait-until-after-class ask — one click
                       queues it as a pinned note with its due date. */
                    <div className="flex items-start gap-2">
                      <a href={r.href} className="flex-1 block group hover:[&_span]:text-hgl-blue">
                        {inner}
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch('/api/admin/dashboard-notes', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'add', body: r.quickNote!.body }),
                          })
                          load()
                        }}
                        className="text-[11px] font-semibold text-hgl-blue underline hover:text-hgl-slate shrink-0 mt-0.5"
                        title="Add this as a pinned note with the suggested due date"
                      >
                        {r.quickNote.label}
                      </button>
                    </div>
                  ) : (
                    <a href={r.href} className="block group hover:[&_span]:text-hgl-blue">
                      {inner}
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* PL-133: text + done, nothing else. Anything a phone call
            interrupts with becomes a pinned row instead of a desk sticky. */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addNote()
              }}
              maxLength={2000}
              placeholder="Add a note — anything you'd otherwise write on a sticky"
              className="flex-1 border border-gray-300 rounded p-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-hgl-blue"
            />
            <button
              type="button"
              onClick={addNote}
              disabled={noteBusy || !noteDraft.trim()}
              className="text-xs font-bold bg-hgl-slate text-white rounded px-3 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Restrained extras — PL-205: above the fold, under attention. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-5">
          <h2 className="text-sm font-bold text-hgl-slate mb-2">Upcoming classes</h2>
          {upcoming.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No classes starting soon.</p>
          ) : (
            <ul className="text-xs space-y-1.5">
              {upcoming.map((c) => (
                <li key={c.id}>
                  <a href={c.href} className="text-gray-700 hover:text-hgl-blue">
                    <span className="font-semibold text-hgl-slate">{c.label}</span> · starts {c.startDate} ·{' '}
                    {c.paid} paid{c.min != null ? ` / min ${c.min}` : ''}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-md border-t-4 border-purple-400 p-5">
          <h2 className="text-sm font-bold text-hgl-slate mb-2">This week&apos;s tutoring</h2>
          <p className="text-3xl font-bold text-hgl-slate">{weekSessions}</p>
          <p className="text-xs text-gray-400">confirmed 1-on-1 sessions in the next 7 days</p>
          {/* PL-173: the same window's proposed count always rides along —
              a technically-right "0 confirmed" told half the state. +0 would
              be noise, so zero renders nothing. */}
          {weekProposed > 0 && (
            <p className="text-xs font-semibold text-amber-700">
              +{weekProposed} proposed, awaiting family confirmation
            </p>
          )}
          <a href="/admin/tutoring" className="text-xs text-hgl-blue underline">
            open the tutoring page →
          </a>
        </div>
      </div>
        {/* PL-204: the term glance, one click away. */}
        <p className="text-xs">
          <a href="/admin/report" className="text-hgl-blue underline">
            Term report — enrollment &amp; revenue →
          </a>
        </p>
      </div>

      {/* Right column: health + activity. */}
      <div className="space-y-6">
      {/* PL-136: system health — three live numbers, shipped BEFORE launch.
          The July 23 quota exhaustion is why: sends failed silently until an
          external email happened to arrive. PL-331: admin only — for the
          manager role the same numbers live under Settings → System health. */}
      {role !== 'manager' && !simulatedManager && (
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-5">
          <h2 className="text-lg font-bold text-hgl-slate mb-1">System health</h2>
          <p className="text-xs text-gray-400 mb-3">
            Three numbers that fail quietly when they fail.
          </p>
          {health ? <SystemHealthBody health={health} /> : <p className="text-sm text-gray-400">—</p>}
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-5">
        <h2 className="text-lg font-bold text-hgl-slate mb-1">Recent activity</h2>
        <p className="text-xs text-gray-400 mb-3">Informational — nothing here needs action.</p>
        {/* PL-134: the chips derive from the types the feed actually emits,
            so a new activity type appears here on its own. */}
        {activityTypes.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {['All', ...activityTypes].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActivityFilter(t)}
                className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 border ${
                  activityFilter === t
                    ? 'bg-hgl-slate text-white border-hgl-slate'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {visibleActivity.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            {activityFilter === 'All' ? 'Quiet so far.' : `Nothing under ${activityFilter}.`}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {groupActivity(visibleActivity).map((g) => {
              const first = g.rows[0]
              if (g.rows.length === 1) {
                return (
                  <li key={g.key} className="py-1.5">
                    <a href={first.href} className="block text-gray-700 hover:text-hgl-blue">
                      <span className="text-xs text-gray-400 mr-2">{fmtWhen(first.when)}</span>
                      {first.text}
                    </a>
                  </li>
                )
              }
              const open = expandedGroups.includes(g.key)
              const noun = (first.type ?? 'items').toLowerCase()
              return (
                <li key={g.key} className="py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedGroups((prev) =>
                        prev.includes(g.key) ? prev.filter((k) => k !== g.key) : [...prev, g.key]
                      )
                    }
                    className="block w-full text-left text-gray-700 hover:text-hgl-blue"
                  >
                    <span className="text-xs text-gray-400 mr-2">{fmtWhen(first.when)}</span>
                    {g.rows.length} {noun}
                    {first.groupLabel ? ` for ${first.groupLabel}` : ''}
                    <span className="text-xs text-gray-400 ml-1">{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <ul className="mt-1 ml-4 space-y-0.5 border-l border-gray-200 pl-3">
                      {g.rows.map((r) => (
                        <li key={r.id}>
                          <a href={r.href} className="block text-xs text-gray-600 hover:text-hgl-blue">
                            <span className="text-gray-400 mr-2">{fmtWhen(r.when)}</span>
                            {r.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      </div>
    </div>
  )
}
