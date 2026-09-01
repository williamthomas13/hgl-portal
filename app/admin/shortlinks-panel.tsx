'use client'

import { useCallback, useEffect, useState } from 'react'
import { ConfirmAction } from './tutoring/confirm'

// PL-384 (supersedes PL-349): Classes → Short links under the ONE link
// model — one link per school or course, evergreen; it always works, even
// between classes. Codes serve their newest open class's page in place;
// nothing open → the leave-your-email page at the same URL. The old
// class-shortcode layer (and its repoint machinery) is gone — the printed
// codes (isd, mis, nido, sls) carried over as their schools' codes, click
// history intact. Pins cover the two-open-classes case, plainly badged.

type Serving = { classId: string; label: string; pinned: boolean } | null
type Candidate = { id: string; label: string }
type Clicks = { total: number; last14: number }
type SchoolRow = {
  id: string
  name: string
  nickname: string | null
  evergreen_code: string | null
  evergreen_pin_class_id: string | null
  serving: Serving
  candidates: Candidate[]
  clicks: Clicks
}
type CourseRow = {
  course_key: string
  display_name: string | null
  evergreen_code: string | null
  evergreen_pin_class_id: string | null
  serving: Serving
  candidates: Candidate[]
  clicks: Clicks
}
type LegacyRow = { code: string; destination: string; note: string | null }

export default function ShortlinksPanel() {
  const [data, setData] = useState<{ schools: SchoolRow[]; courses: CourseRow[]; legacy: LegacyRow[] } | null>(null)
  const [msg, setMsg] = useState('')
  // PL-448: non-blocking heads-ups (a new code shadowing a live main-site path).
  const [warn, setWarn] = useState('')
  const [newLegacy, setNewLegacy] = useState({ code: '', destination: '', note: '' })

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/evergreen')
    const json = await res.json().catch(() => null)
    if (res.ok && json) setData(json)
    else setMsg("Couldn't load the links — check your connection.")
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const post = async (body: Record<string, unknown>) => {
    setMsg('')
    setWarn('')
    const res = await fetch('/api/admin/evergreen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMsg(json.error ?? 'That change failed.')
      return false
    }
    if (json.warning) setWarn(json.warning) // PL-448: warn, never block
    await load()
    return true
  }

  if (!data) return <p className="text-sm text-gray-500 italic">Loading links…</p>

  const codeInput = (value: string | null, onSave: (v: string) => void, placeholder: string) => (
    <input
      defaultValue={value ?? ''}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value.trim().toLowerCase()
        if (v !== (value ?? '')) onSave(v)
      }}
      className="border border-gray-300 rounded px-2 py-1 text-sm w-36 font-mono"
    />
  )

  const servingLine = (row: { evergreen_code: string | null; serving: Serving; clicks: Clicks }) =>
    row.evergreen_code ? (
      <>
        {row.serving ? (
          <span className="text-xs text-gray-500">
            now showing <span className="font-semibold text-gray-700">{row.serving.label}</span>
            {row.serving.pinned && (
              <span className="ml-1 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                pinned to {row.serving.label}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-gray-400 italic">between classes — showing the interest page</span>
        )}
        <span className="text-xs text-gray-400">
          {row.clicks.total} visit{row.clicks.total === 1 ? '' : 's'}
          {row.clicks.last14 > 0 ? ` (${row.clicks.last14} in the last 14 days)` : ''}
        </span>
      </>
    ) : null

  const pinControl = (
    row: { evergreen_code: string | null; evergreen_pin_class_id: string | null; candidates: Candidate[] },
    save: (classId: string | null) => void
  ) => {
    if (!row.evergreen_code || row.candidates.length < 2) {
      // With 0–1 open classes "newest open" can't surprise anyone — no pin UI.
      return row.evergreen_pin_class_id ? (
        <button onClick={() => save(null)} className="text-xs text-gray-500 underline">
          unpin
        </button>
      ) : null
    }
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-gray-400" title="Two classes are open at once — pin the link to one so a new class opening doesn't steal it mid-campaign. A pinned class that closes falls back to newest-open automatically.">
          pin:
        </span>
        <select
          value={row.evergreen_pin_class_id ?? ''}
          onChange={(e) => save(e.target.value || null)}
          className="border border-gray-300 rounded p-0.5 text-xs bg-white max-w-48"
        >
          <option value="">auto (newest open)</option>
          {row.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {row.evergreen_pin_class_id && (
          <button onClick={() => save(null)} className="text-gray-500 underline">
            unpin
          </button>
        )}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        <span className="font-semibold text-hgl-slate">One link per school or course — it always
        works, even between classes.</span>{' '}
        Each code shows the newest open class right at hgl.co/{'{code}'} (no redirect), and turns
        into a leave-your-email page when nothing is open. Registration lives at
        hgl.co/{'{code}'}/register. Printed codes never need reprinting or repointing.
      </p>
      {msg && <p className="text-sm text-red-600 font-semibold">{msg}</p>}
      {warn && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">{warn}</p>
      )}
      <div className="border border-gray-200 rounded-lg p-4">
        <p className="font-bold text-hgl-slate mb-3">School links</p>
        <ul className="space-y-1.5">
          {data.schools.map((sc) => (
            <li key={sc.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-hgl-slate min-w-48">{sc.nickname ?? sc.name}</span>
              <span className="text-gray-400">hgl.co/</span>
              {codeInput(sc.evergreen_code, (v) => post({ action: 'set_school_code', id: sc.id, code: v }), 'no code yet')}
              {servingLine(sc)}
              {pinControl(sc, (classId) => post({ action: 'set_school_pin', id: sc.id, classId }))}
            </li>
          ))}
        </ul>
      </div>
      <div className="border border-gray-200 rounded-lg p-4">
        <p className="font-bold text-hgl-slate mb-1">Course links</p>
        <p className="text-xs text-gray-500 mb-3">
          Same idea for no-school courses (follow-ups, HGL-taught classes) — every course that has
          ever had a no-school class is listed automatically; saving a code creates its record.
          Claiming a code wins over the automatic main-site forward, so a code that matches a
          shared main-site path (like /act) gets a heads-up when saved.
        </p>
        <ul className="space-y-1.5">
          {data.courses.map((cm) => (
            <li key={cm.course_key} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-hgl-slate min-w-48">{cm.display_name ?? cm.course_key}</span>
              <span className="text-gray-400">hgl.co/</span>
              {codeInput(cm.evergreen_code, (v) => post({ action: 'set_course_code', id: cm.course_key, code: v }), 'no code yet')}
              {servingLine(cm)}
              {pinControl(cm, (classId) => post({ action: 'set_course_pin', id: cm.course_key, classId }))}
            </li>
          ))}
        </ul>
      </div>
      <div className="border border-gray-200 rounded-lg p-4">
        <p className="font-bold text-hgl-slate mb-1">Legacy hgl.co forwards</p>
        <p className="text-xs text-gray-500 mb-3">
          Overrides only: any hgl.co path that isn&apos;t a code automatically forwards to the SAME
          path on highergroundlearning.com (replicating the registrar&apos;s standing wildcard —
          no inventory needed), so a row belongs here only when a path must go somewhere
          DIFFERENT than its same-named main-site page. Claiming a path as an evergreen code
          takes precedence over the wildcard. Retiring a row hands the path back to the wildcard.
        </p>
        <ul className="space-y-1.5 mb-3">
          {data.legacy.map((lr) => (
            <li key={lr.code} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-hgl-slate">/{lr.code}</span>
              <span className="text-gray-400">→</span>
              <span className="text-gray-600 break-all">{lr.destination}</span>
              {lr.note && <span className="text-xs text-gray-400">({lr.note})</span>}
              <ConfirmAction
                label="retire"
                message={`Retire the /${lr.code} override? The path falls back to the automatic wildcard — hgl.co/${lr.code} will forward to highergroundlearning.com/${lr.code}.`}
                confirmLabel="Yes, retire it"
                className="text-xs text-red-600 underline"
                confirmClassName="text-xs text-red-700 font-semibold underline"
                onConfirm={() => post({ action: 'delete_legacy', code: lr.code })}
              />
            </li>
          ))}
          {data.legacy.length === 0 && <li className="text-sm text-gray-400 italic">none recorded</li>}
        </ul>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-400">hgl.co/</span>
          <input
            value={newLegacy.code}
            onChange={(e) => setNewLegacy((p) => ({ ...p, code: e.target.value }))}
            placeholder="code"
            className="border border-gray-300 rounded px-2 py-1 w-28 font-mono"
          />
          <span className="text-gray-400">→</span>
          <input
            value={newLegacy.destination}
            onChange={(e) => setNewLegacy((p) => ({ ...p, destination: e.target.value }))}
            placeholder="https://highergroundlearning.com/…"
            className="border border-gray-300 rounded px-2 py-1 w-72"
          />
          <input
            value={newLegacy.note}
            onChange={(e) => setNewLegacy((p) => ({ ...p, note: e.target.value }))}
            placeholder="note"
            className="border border-gray-300 rounded px-2 py-1 w-40"
          />
          <button
            onClick={async () => {
              const ok = await post({ action: 'set_legacy', ...newLegacy })
              if (ok) setNewLegacy({ code: '', destination: '', note: '' })
            }}
            disabled={!newLegacy.code.trim() || !newLegacy.destination.trim()}
            className="bg-hgl-slate text-white text-xs font-bold py-1.5 px-3 rounded disabled:opacity-40"
          >
            Add forward
          </button>
        </div>
      </div>
    </div>
  )
}
