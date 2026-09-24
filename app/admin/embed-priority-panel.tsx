'use client'

import { useEffect, useState } from 'react'

// PL-506: Settings → Site content → the homepage strip's priority schools —
// an ordered list (Scarlett's six by default) that the embed puts first
// whenever they have a class in the state being shown. Move / remove / add.
type School = { id: string; name: string; nickname: string }

export default function EmbedPriorityPanel() {
  const [schools, setSchools] = useState<School[]>([])
  const [priority, setPriority] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState('')
  useEffect(() => {
    fetch('/api/admin/embed-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { setSchools(j.schools ?? []); setPriority(j.priority ?? []) } setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])
  const byId = new Map(schools.map((s) => [s.id, s]))
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= priority.length) return; const next = [...priority]; [next[i], next[j]] = [next[j], next[i]]; setPriority(next) }
  async function save() {
    setBusy(true); setMsg('')
    const res = await fetch('/api/admin/embed-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority }) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) setPriority(j.priority ?? priority)
    setMsg(res.ok ? 'Saved — the homepage strip picks it up within 5 minutes (edge cache).' : `Error: ${j.error ?? res.status}`)
  }
  if (!loaded) return <p className="text-sm text-gray-500">Loading…</p>
  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-4" data-testid="embed-priority-panel">
      <div>
        <h2 className="text-lg font-bold text-hgl-slate">Homepage strip: priority schools</h2>
        <p className="text-sm text-gray-500 mt-1">
          The homepage&apos;s class strip shows these schools first, in this order, whenever they have a class in the state it is showing (upcoming, current or recent). After them: soonest start, fewest paid students, newest school. Change it per season.
        </p>
      </div>
      <ol className="space-y-1.5" data-testid="embed-priority-list">
        {priority.map((id, i) => (
          <li key={id} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-right text-gray-400">{i + 1}.</span>
            <button type="button" onClick={() => move(i, -1)} className="text-xs text-gray-500 px-1" aria-label="Move up">↑</button>
            <button type="button" onClick={() => move(i, 1)} className="text-xs text-gray-500 px-1" aria-label="Move down">↓</button>
            <span className="font-semibold text-hgl-slate">{byId.get(id)?.nickname ?? '?'}</span>
            <span className="text-gray-500">{byId.get(id)?.name ?? id}</span>
            <button type="button" onClick={() => setPriority(priority.filter((x) => x !== id))} className="text-xs text-red-600 underline ml-2">remove</button>
          </li>
        ))}
        {priority.length === 0 && <li className="text-sm text-gray-500 italic">No priority schools — the strip orders purely by date.</li>}
      </ol>
      <div className="flex items-center gap-2 text-sm">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} className="border border-gray-300 rounded p-1.5 bg-white">
          <option value="">Add a school…</option>
          {schools.filter((s) => !priority.includes(s.id)).map((s) => (
            <option key={s.id} value={s.id}>{s.nickname} — {s.name}</option>
          ))}
        </select>
        <button type="button" disabled={!adding} onClick={() => { setPriority([...priority, adding]); setAdding('') }} className="text-xs font-semibold text-hgl-blue underline disabled:opacity-40">+ add</button>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="bg-hgl-blue text-white font-bold px-4 py-2 rounded-md disabled:opacity-50" data-testid="embed-priority-save">{busy ? 'Saving…' : 'Save order'}</button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}
