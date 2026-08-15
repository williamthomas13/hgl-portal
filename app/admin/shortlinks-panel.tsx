'use client'

import { useCallback, useEffect, useState } from 'react'

// PL-349: Classes → Short links — every hgl.co code, what it points at,
// when it last changed, and a REPOINT control ("aisct" means "AISCT's
// current class"; next season the code repoints and printed collateral
// never dies). Inline confirm banners only — repointing is deliberate.
// Deep-linked by the dashboard's repoint nudge as
// /admin?tab=classes&section=shortlinks&repoint={code} (the nudge row is
// the memory, the click here is the decision).

type LinkRow = {
  code: string
  classId: string | null
  schoolId: string | null
  schoolNickname: string | null
  target: { id: string; slug: string | null; label: string; status: string; startDate: string | null } | null
  updatedAt: string
  updatedBy: string | null
  clicks: { total: number; last14: number }
}
type Candidate = { id: string; slug: string | null; schoolId: string | null; label: string; startDate: string | null }

export default function ShortlinksPanel() {
  const [links, setLinks] = useState<LinkRow[] | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Per-row in-flight edit: which code is repointing/retiring, and to what.
  const [repoint, setRepoint] = useState<{ code: string; classId: string } | null>(null)
  const [retiring, setRetiring] = useState('')
  const [busy, setBusy] = useState(false)
  // Create form.
  const [newCode, setNewCode] = useState('')
  const [newClassId, setNewClassId] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/shortlinks')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? `The server returned ${res.status}.`)
        setLinks(null)
        return
      }
      setLinks(json.links ?? [])
      setCandidates(json.candidates ?? [])
      setError('')
    } catch {
      setError("Couldn't load the short links — check your connection.")
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Deep-link: ?repoint={code} pre-opens that row's repoint control with the
  // school's first live class suggested (window.location, not
  // useSearchParams — the topline precedent, no Suspense boundary needed).
  useEffect(() => {
    if (!links) return
    const code = new URLSearchParams(window.location.search).get('repoint')
    if (!code) return
    const row = links.find((l) => l.code === code)
    if (!row) return
    const suggested = candidates.find(
      (c) => c.schoolId != null && c.schoolId === row.schoolId && c.id !== row.target?.id
    )
    setRepoint((cur) => cur ?? { code, classId: suggested?.id ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links === null])

  async function post(payload: Record<string, unknown>, doneNote: string) {
    setBusy(true)
    setNotice('')
    try {
      const res = await fetch('/api/admin/shortlinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'That change failed.')
        return false
      }
      setError('')
      setNotice(doneNote)
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  const targetNote = (l: LinkRow) => {
    if (!l.target) return <span className="text-amber-700">nothing — idle code</span>
    const finished = l.target.status === 'cancelled'
    return (
      <>
        {l.target.slug ? (
          <a href={`/c/${l.target.slug}`} target="_blank" rel="noreferrer" className="text-hgl-blue underline">
            {l.target.label}
          </a>
        ) : (
          l.target.label
        )}
        {finished && <span className="text-xs text-amber-700 ml-1.5">cancelled — visitors get the honest state page</span>}
      </>
    )
  }

  if (error && !links) return <p className="text-sm text-red-600">{error}</p>
  if (!links) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        A code is a PERMANENT printed address — hgl.co/aisct means &ldquo;AISCT&apos;s current
        class&rdquo;. When a new class opens, repoint the code instead of reprinting collateral.
        Unknown or idle codes land on the honest no-active-class page, never a 404. Click counts
        are per day, first-party only.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-green-700">{notice}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold text-gray-500 uppercase tracking-wide border-b border-gray-200">
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">Points at</th>
              <th className="py-2 pr-4">Clicks (14 days / all)</th>
              <th className="py-2 pr-4">Last changed</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {links.map((l) => (
              <tr key={l.code} className="align-top">
                <td className="py-2 pr-4 whitespace-nowrap">
                  <a href={`/${l.code}`} target="_blank" rel="noreferrer" className="text-hgl-blue underline">
                    hgl.co/{l.code}
                  </a>
                </td>
                <td className="py-2 pr-4">
                  {targetNote(l)}
                  {repoint?.code === l.code && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2.5 space-y-2">
                      <select
                        value={repoint.classId}
                        onChange={(e) => setRepoint({ code: l.code, classId: e.target.value })}
                        className="w-full border border-gray-300 rounded p-1.5 bg-white text-sm"
                      >
                        <option value="">Pick the class this code should open…</option>
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                      {repoint.classId && (
                        <p className="text-xs text-amber-900">
                          Point <strong>hgl.co/{l.code}</strong> at{' '}
                          <strong>{candidates.find((c) => c.id === repoint.classId)?.label}</strong>? Anyone
                          using the printed link lands on that class&apos;s page from now on.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          disabled={busy || !repoint.classId}
                          onClick={async () => {
                            const ok = await post(
                              { action: 'repoint', code: l.code, classId: repoint.classId },
                              `hgl.co/${l.code} repointed.`
                            )
                            if (ok) setRepoint(null)
                          }}
                          className="bg-amber-600 text-white text-xs font-bold py-1.5 px-3 rounded disabled:opacity-40"
                        >
                          {busy ? 'Repointing…' : 'Repoint'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setRepoint(null)}
                          className="bg-gray-100 text-gray-700 text-xs font-bold py-1.5 px-3 rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {retiring === l.code && (
                    <div className="mt-2 bg-red-50 border border-red-200 rounded p-2.5 space-y-2">
                      <p className="text-xs text-red-900">
                        Retire <strong>hgl.co/{l.code}</strong>? Anything printed with it will land on
                        the honest no-active-class page (never a 404). Click history is kept.
                      </p>
                      <div className="flex gap-2">
                        <button
                          disabled={busy}
                          onClick={async () => {
                            const ok = await post({ action: 'retire', code: l.code }, `hgl.co/${l.code} retired.`)
                            if (ok) setRetiring('')
                          }}
                          className="bg-red-600 text-white text-xs font-bold py-1.5 px-3 rounded disabled:opacity-40"
                        >
                          {busy ? 'Retiring…' : 'Retire the code'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setRetiring('')}
                          className="bg-gray-100 text-gray-700 text-xs font-bold py-1.5 px-3 rounded"
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap text-gray-600">
                  {l.clicks.last14} / {l.clicks.total}
                </td>
                <td className="py-2 pr-4 text-gray-500 text-xs">
                  {new Date(l.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                  {l.updatedBy ? <><br />by {l.updatedBy}</> : ''}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  <button
                    onClick={() => {
                      setRetiring('')
                      setRepoint(repoint?.code === l.code ? null : { code: l.code, classId: '' })
                    }}
                    className="text-xs text-hgl-blue underline mr-3"
                  >
                    Repoint…
                  </button>
                  <button
                    onClick={() => {
                      setRepoint(null)
                      setRetiring(retiring === l.code ? '' : l.code)
                    }}
                    className="text-xs text-red-600 underline"
                  >
                    Retire…
                  </button>
                </td>
              </tr>
            ))}
            {links.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-gray-500 italic">
                  No short links yet — add the first one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border border-gray-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">New code</label>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-sm text-gray-500">hgl.co/</span>
            <input
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toLowerCase())}
              placeholder="aisct"
              className="border border-gray-300 rounded p-1.5 text-sm w-32"
            />
          </div>
        </div>
        <div className="flex-1 min-w-56">
          <label className="block text-xs text-gray-600">Opens</label>
          <select
            value={newClassId}
            onChange={(e) => setNewClassId(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded p-1.5 bg-white text-sm"
          >
            <option value="">Pick a class…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <button
          disabled={busy || !newCode.trim() || !newClassId}
          onClick={async () => {
            const ok = await post(
              { action: 'create', code: newCode.trim(), classId: newClassId },
              `hgl.co/${newCode.trim()} created.`
            )
            if (ok) {
              setNewCode('')
              setNewClassId('')
            }
          }}
          className="bg-hgl-slate text-white text-xs font-bold py-2 px-4 rounded disabled:opacity-40"
        >
          Add short link
        </button>
      </div>
    </div>
  )
}
