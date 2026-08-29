'use client'

import { useState } from 'react'
import { WEEKDAYS } from './types'
import type { Subject, Tutor } from './types'
import { groupSubjects } from '../../utils/subject-groups'
import { staffTimeCityLabel } from '../../utils/dates'

// PL-226: tutors ARE instructors, and this panel is now a read-only
// REPRESENTATION of that shared record + a matching FINDER (subject +
// timezone + name). Identity and profile editing moved to
// Contacts→Instructors (the one edit surface); the tutoring-specific action
// that stays here is onboard/retire (PL-223's access-aware flow). Matching
// notes live in tutor_notes (staff-only table) so a tutor reading their own
// instructors row never sees them.

// PL-226 C: friendly timezone regions for the finder.
function tzRegion(tz: string): 'americas' | 'emea' | 'apac' | 'other' {
  if (/^America\//.test(tz)) return 'americas'
  if (/^(Europe|Africa|Atlantic)\//.test(tz) || tz === 'UTC') return 'emea'
  if (/^(Asia|Australia|Pacific|Indian)\//.test(tz)) return 'apac'
  return 'other'
}
const TZ_REGION_LABELS: Record<string, string> = {
  americas: 'Americas',
  emea: 'Europe & Africa',
  apac: 'Asia-Pacific',
}

// PL-320/PL-324: subjects render as a grouped category summary ("Math (9) ·
// Test prep (7)") where EACH heading expands independently — clicking
// "Math (11)" opens only Math; several can be open at once; clicking again
// collapses that one. An active subject filter auto-opens ONLY the matching
// category and highlights its chip. Grouping is the ONE shared source
// (utils/subject-groups).
function SubjectSummaryCell({
  tutor,
  subjects,
  filter,
}: {
  tutor: Tutor
  subjects: Subject[]
  filter: string
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const catByName = new Map(subjects.map((s) => [s.name, s.category]))
  const ready = groupSubjects(tutor.subjects.map((name) => ({ name, category: catByName.get(name) })))
  const prep = tutor.subjects_with_prep ?? []
  if (tutor.subjects.length === 0 && prep.length === 0) {
    return <span className="italic text-gray-400">none set</span>
  }
  // The filter opens exactly the category that holds the filtered subject.
  const filterGroup = filter
    ? tutor.subjects.includes(filter)
      ? ready.find((g) => g.names.includes(filter))?.group ?? null
      : prep.includes(filter)
        ? 'prep'
        : null
    : null
  const isOpen = (key: string) => openGroups[key] === true || filterGroup === key
  const toggle = (key: string) => setOpenGroups((o) => ({ ...o, [key]: !isOpen(key) }))

  const chip = (n: string, flavor: 'ready' | 'prep') => (
    <span
      key={n}
      className={`rounded-full px-2 py-0.5 border ${
        filter === n
          ? flavor === 'ready'
            ? 'bg-hgl-blue text-white border-hgl-blue font-semibold'
            : 'bg-amber-600 text-white border-amber-600 font-semibold'
          : flavor === 'ready'
            ? 'bg-gray-100 border-gray-200 text-gray-600'
            : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
    >
      {n}
    </span>
  )

  return (
    <div className="text-xs">
      <span className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-gray-600">
        {ready.map((g, i) => (
          <button
            key={g.group}
            type="button"
            onClick={() => toggle(g.group)}
            className={`hover:text-hgl-slate ${isOpen(g.group) ? 'font-semibold text-hgl-slate' : ''}`}
            title={isOpen(g.group) ? `Collapse ${g.group}` : `Show the ${g.group} subjects`}
          >
            {i > 0 && <span className="text-gray-300 font-normal mr-1.5">·</span>}
            {g.group} ({g.names.length}) {isOpen(g.group) ? '▾' : '▸'}
          </button>
        ))}
        {prep.length > 0 && (
          <button
            key="prep"
            type="button"
            onClick={() => toggle('prep')}
            className={`text-amber-700 hover:text-amber-900 ${isOpen('prep') ? 'font-semibold' : ''}`}
            title="Capable with prep — confirm with the tutor first"
          >
            {ready.length > 0 && <span className="text-gray-300 font-normal mr-1.5">·</span>}
            with prep ({prep.length}) {isOpen('prep') ? '▾' : '▸'}
          </button>
        )}
      </span>
      {(ready.some((g) => isOpen(g.group)) || isOpen('prep')) && (
        <div className="mt-1.5 space-y-1.5">
          {ready.filter((g) => isOpen(g.group)).map((g) => (
            <div key={g.group}>
              <span className="font-semibold text-gray-500">{g.group}</span>
              <span className="flex flex-wrap gap-1 mt-0.5">{g.names.map((n) => chip(n, 'ready'))}</span>
            </div>
          ))}
          {/* PL-35a: capable-but-confirm-first set, visually distinct. */}
          {isOpen('prep') && prep.length > 0 && (
            <div>
              <span className="font-semibold text-amber-700">With prep — confirm first</span>
              <span className="flex flex-wrap gap-1 mt-0.5">{prep.map((n) => chip(n, 'prep'))}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TutorsPanel({
  tutors,
  subjects,
  notes,
  onChange,
}: {
  tutors: Tutor[]
  subjects: Subject[]
  notes: Record<string, string>
  onChange: () => void
}) {
  const [message, setMessage] = useState('')
  // PL-226 C: the finder — filters combine (subject AND timezone AND name).
  const [search, setSearch] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [tzFilter, setTzFilter] = useState('')

  // PL-223: retire is access-aware — the server checks whether the person
  // still teaches classes, and the confirm says plainly what will happen to
  // their login BEFORE the click. Un-retire restores only what retire took.
  const [armedRetire, setArmedRetire] = useState<null | {
    id: string
    tutorOnly: boolean
    active: boolean
    teachingClasses: string[]
  }>(null)
  const [busyRetire, setBusyRetire] = useState(false)

  async function armRetire(t: Tutor) {
    setBusyRetire(true)
    setMessage('')
    try {
      const res = await fetch(`/api/admin/tutoring/retire?instructor=${t.id}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setMessage('Error: ' + (json.error ?? res.status))
      else
        setArmedRetire({
          id: t.id,
          tutorOnly: json.tutorOnly,
          active: json.active,
          teachingClasses: json.teachingClasses ?? [],
        })
    } catch {
      setMessage("Error: couldn't reach the server.")
    } finally {
      setBusyRetire(false)
    }
  }

  async function retireCall(t: Tutor, action: 'retire' | 'unretire') {
    setBusyRetire(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/tutoring/retire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructor_id: t.id, action }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setMessage('Error: ' + (json.error ?? res.status))
      else {
        setMessage(json.message ?? 'Done.')
        setArmedRetire(null)
        onChange()
      }
    } catch {
      setMessage("Error: couldn't reach the server.")
    } finally {
      setBusyRetire(false)
    }
  }

  const active = tutors.filter((t) => t.tutoring_active)
  const inactive = tutors.filter((t) => !t.tutoring_active)
  // PL-42: Active/Former split with reactivate — never deletion (a tutor with
  // session/timecard history must keep their record). "Former" also holds
  // seeded tutors Kelsie hasn't onboarded yet; reactivate is the same flip.
  const [view, setView] = useState<'active' | 'former'>('active')
  const matchesFilters = (t: Tutor) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!`${t.name ?? ''} ${t.email}`.toLowerCase().includes(q)) return false
    }
    if (subjectFilter) {
      const ready = t.subjects.includes(subjectFilter)
      const prep = (t.subjects_with_prep ?? []).includes(subjectFilter)
      if (!ready && !prep) return false
    }
    if (tzFilter && tzRegion(t.timezone) !== tzFilter) return false
    return true
  }
  const shown = (view === 'active' ? active : inactive).filter(matchesFilters)

  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-500">
        Tutors are the same people as instructors — turning tutoring on here makes them schedulable
        for 1-on-1 students. Their Google Workspace address is where sessions get pushed; they
        keep blocking their availability in Google Calendar as always. Retiring a tutor keeps
        their whole history — reactivate any time from the Former tab.
      </p>
      {/* PL-226: identity + profile editing consolidated in one place. */}
      <p className="text-xs text-gray-600 bg-blue-50 border border-blue-200 rounded px-3 py-2">
        To add a tutor or edit their profile (name, email, phone, subjects, timezone, offer
        windows, pay),{' '}
        <a href="/admin?tab=contacts&section=instructors" className="text-hgl-blue underline font-semibold">
          go to Contacts → Instructors
        </a>
        . This panel shows the same records and handles onboarding/retiring for 1-on-1 work.
      </p>

      {/* PL-226 C: the matching finder — "who can tutor Algebra", "who works
          in a European timezone". Filters combine. */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="border border-gray-300 rounded p-1.5 text-sm w-48"
        />
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="border border-gray-300 rounded p-1.5 text-sm"
        >
          <option value="">any subject</option>
          {/* PL-320: options grouped by the shared category mapping. */}
          {groupSubjects(subjects.map((s) => ({ name: s.name, category: s.category }))).map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          value={tzFilter}
          onChange={(e) => setTzFilter(e.target.value)}
          className="border border-gray-300 rounded p-1.5 text-sm"
        >
          <option value="">any timezone</option>
          <option value="americas">Americas</option>
          <option value="emea">Europe &amp; Africa</option>
          <option value="apac">Asia-Pacific</option>
        </select>
        {(search || subjectFilter || tzFilter) && (
          <button
            onClick={() => {
              setSearch('')
              setSubjectFilter('')
              setTzFilter('')
            }}
            className="text-xs text-hgl-blue underline"
          >
            clear filters
          </button>
        )}
      </div>

      <div className="flex rounded-md overflow-hidden border border-gray-300 w-fit">
        {(['active', 'former'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-xs font-semibold ${
              view === v ? 'bg-hgl-slate text-white' : 'bg-white text-gray-600'
            }`}
          >
            {v === 'active' ? `Active (${active.length})` : `Former & not yet onboarded (${inactive.length})`}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="text-gray-500 italic">
          {search || subjectFilter || tzFilter
            ? 'Nobody matches these filters — try clearing one.'
            : view === 'active'
              ? 'No active tutors yet — reactivate one from the other tab.'
              : 'Nobody here.'}
        </p>
      )}
      {shown.length > 0 && (
        /* PL-342 sweep: scroll container — 7 columns incl. Matching notes
           pushed the row tail off-card with no cue at normal widths. */
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              {['Tutor', 'Subjects', 'Timezone', 'Offer windows', 'Default Zoom link', 'Matching notes', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {shown.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50 transition align-top">
                <td className="px-3 py-2">
                  <div className="font-semibold text-hgl-slate">
                    {t.name ?? '—'}
                    {/* PL-212: the pay-type flag is visible at a glance, not
                        buried in the editor. */}
                    {t.pay_type === 'salaried' && (
                      <span className="ml-2 text-[10px] font-bold uppercase bg-purple-100 text-purple-700 rounded-full px-2 py-0.5">
                        Salaried
                      </span>
                    )}
                    {/* PL-226 B: BOTH flags surface coherently — a person who
                        is instructor-inactive can never silently read as
                        "Active" here. */}
                    {!t.active && (
                      <span
                        className="ml-2 text-[10px] font-bold uppercase bg-red-100 text-red-700 rounded-full px-2 py-0.5"
                        title="Deactivated on the Instructors page — they can't sign in regardless of tutoring status"
                      >
                        inactive — can&apos;t sign in
                      </span>
                    )}
                  </div>
                  <div className="text-xs">
                    <a href={`mailto:${t.email}`} className="text-hgl-blue hover:underline">
                      {t.email}
                    </a>
                  </div>
                  {t.google_calendar_id && (
                    <div className="text-xs text-gray-400">cal: {t.google_calendar_id}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600 max-w-64">
                  <SubjectSummaryCell tutor={t} subjects={subjects} filter={subjectFilter} />
                </td>
                <td className="px-3 py-2 text-gray-600" title={t.timezone ?? undefined}>{t.timezone ? `${staffTimeCityLabel(t.timezone)} time` : '—'}</td>
                <td className="px-3 py-2 text-gray-600 max-w-44">
                  {(t.offer_windows ?? []).length > 0 ? (
                    <span className="text-xs">
                      {t.offer_windows.map((w) => `${WEEKDAYS[w.weekday - 1]} ${w.start_time}–${w.end_time}`).join(' · ')}
                    </span>
                  ) : (
                    <span className="italic text-gray-400 text-xs">session hours ±2h (default)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600 max-w-40 truncate">{t.default_meeting_link ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600 max-w-56">
                  <span className="line-clamp-2">{notes[t.id] || <span className="italic text-gray-400">—</span>}</span>
                </td>
                {/* PL-228: no nowrap — the armed retire banner wraps in place. */}
                <td className="px-3 py-2 text-right">
                  {/* PL-226: profile edits live on Contacts→Instructors. */}
                  <a
                    href="/admin?tab=contacts&section=instructors"
                    className="text-xs text-gray-500 underline mr-3"
                    title="Name, email, phone, subjects, and the rest of the profile edit on Contacts → Instructors"
                  >
                    edit in Contacts
                  </a>
                  {armedRetire?.id === t.id ? (
                    <span className="inline-flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded px-2 py-1 max-w-md whitespace-normal text-left align-top text-xs">
                      <span className="text-amber-900">
                        {armedRetire.tutorOnly
                          ? armedRetire.active
                            ? `Retire ${t.name ?? 'this tutor'}? They have no other active role, so this also ends their portal login. History stays; reactivate any time from the Former tab.`
                            : `Retire ${t.name ?? 'this tutor'}? Their portal login is already off; this ends 1-on-1 tutoring.`
                          : `Retire ${t.name ?? 'this tutor'} from 1-on-1 tutoring? Their login stays because they still teach ${armedRetire.teachingClasses.join(', ')} — deactivate them on the Instructors page if they're leaving entirely.`}
                      </span>
                      <button
                        disabled={busyRetire}
                        onClick={() => retireCall(t, 'retire')}
                        className="text-red-700 font-semibold underline"
                      >
                        {armedRetire.tutorOnly && armedRetire.active
                          ? 'Retire & end their login'
                          : 'Retire from tutoring'}
                      </button>
                      <button onClick={() => setArmedRetire(null)} className="text-gray-500 underline">
                        cancel
                      </button>
                    </span>
                  ) : view === 'active' ? (
                    <button
                      disabled={busyRetire}
                      onClick={() => armRetire(t)}
                      className="text-xs text-gray-500 underline disabled:opacity-50"
                    >
                      retire
                    </button>
                  ) : (
                    <button
                      disabled={busyRetire}
                      onClick={() => retireCall(t, 'unretire')}
                      className="text-xs text-green-700 underline font-semibold disabled:opacity-50"
                    >
                      reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}


      {message && (
        <div
          className={`p-3 rounded font-semibold text-center ${
            message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
