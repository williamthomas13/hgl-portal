'use client'

import { useEffect, useState } from 'react'

// PL-507: Settings → Site content → the homepage "Meet our team" strip's
// members — an ordered list (the four leadership entries by default; 1–12).
// Only people shown on /team are offered; hiding someone from /team drops
// them from the homepage automatically.
type Person = { id: string; name: string; credential: string | null }

export default function EmbedTeamPanel() {
  const [people, setPeople] = useState<Person[]>([])
  const [members, setMembers] = useState<string[]>([])
  const [cap, setCap] = useState(12)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState('')
  useEffect(() => {
    fetch('/api/admin/embed-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { setPeople(j.people ?? []); setMembers(j.members ?? []); setCap(j.teamCap ?? 12) } setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])
  const byId = new Map(people.map((p) => [p.id, p]))
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= members.length) return; const next = [...members]; [next[i], next[j]] = [next[j], next[i]]; setMembers(next) }
  async function save() {
    setBusy(true); setMsg('')
    const res = await fetch('/api/admin/embed-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_team_members', members }) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) setMembers(j.members ?? members)
    setMsg(res.ok ? 'Saved — the homepage picks it up within 5 minutes (edge cache).' : `Error: ${j.error ?? res.status}`)
  }
  if (!loaded) return <p className="text-sm text-gray-500">Loading…</p>
  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-4" data-testid="embed-team-panel">
      <div>
        <h2 className="text-lg font-bold text-hgl-slate">Homepage strip: team members</h2>
        <p className="text-sm text-gray-500 mt-1">
          Who the homepage&apos;s &ldquo;Meet our team&rdquo; section shows, in this order (1–{cap}). Photos, names and the credential line come from each person&apos;s /team profile. Someone hidden from /team drops off the homepage automatically.
        </p>
      </div>
      <ol className="space-y-1.5" data-testid="embed-team-list">
        {members.map((id, i) => (
          <li key={id} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-right text-gray-400">{i + 1}.</span>
            <button type="button" onClick={() => move(i, -1)} className="text-xs text-gray-500 px-1" aria-label="Move up">↑</button>
            <button type="button" onClick={() => move(i, 1)} className="text-xs text-gray-500 px-1" aria-label="Move down">↓</button>
            <span className="font-semibold text-hgl-slate">{byId.get(id)?.name ?? '(no longer on /team)'}</span>
            <span className="text-gray-500">{byId.get(id)?.credential ?? ''}</span>
            <button type="button" onClick={() => setMembers(members.filter((x) => x !== id))} className="text-xs text-red-600 underline ml-2">remove</button>
          </li>
        ))}
        {members.length === 0 && <li className="text-sm text-gray-500 italic">Nobody chosen — the homepage shows the heading and the button only.</li>}
      </ol>
      <div className="flex items-center gap-2 text-sm">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} className="border border-gray-300 rounded p-1.5 bg-white" disabled={members.length >= cap}>
          <option value="">Add a person…</option>
          {people.filter((p) => !members.includes(p.id)).map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.credential ? ` — ${p.credential}` : ''}</option>
          ))}
        </select>
        <button type="button" disabled={!adding || members.length >= cap} onClick={() => { setMembers([...members, adding]); setAdding('') }} className="text-xs font-semibold text-hgl-blue underline disabled:opacity-40">+ add</button>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="bg-hgl-blue text-white font-bold px-4 py-2 rounded-md disabled:opacity-50" data-testid="embed-team-save">{busy ? 'Saving…' : 'Save members'}</button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}
