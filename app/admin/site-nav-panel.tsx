'use client'

import { useEffect, useState } from 'react'

// PL-478: the public header/footer menu is an EDITABLE list — label, URL,
// order, show/hide — seeded with highergroundlearning.com's menu. Scarlett
// mirrors a main-site menu change here without Code. Portal pages use
// site-relative URLs (/classes, /team); main-site pages absolute URLs.
// PL-492/493: ONE level of nesting — a header folder ("Tutoring" → the
// service links) or a footer column (a heading, or none, over its links).
// A saved flat menu from before is shown already nested (migrated in place).

type NavItem = { label: string; url: string; show: boolean; key?: string; children?: NavItem[] }

function Row({
  it,
  onChange,
  onRemove,
  onMove,
  child = false,
  onAddChild,
}: {
  it: NavItem
  onChange: (patch: Partial<NavItem>) => void
  onRemove: () => void
  onMove: (d: -1 | 1) => void
  child?: boolean
  onAddChild?: () => void
}) {
  const folder = Boolean(it.children)
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${child ? 'pl-8' : ''}`}>
      <button type="button" onClick={() => onMove(-1)} className="text-xs text-gray-500 px-1" aria-label="Move up">↑</button>
      <button type="button" onClick={() => onMove(1)} className="text-xs text-gray-500 px-1" aria-label="Move down">↓</button>
      <input value={it.label} onChange={(e) => onChange({ label: e.target.value })} className="border border-gray-300 rounded p-1.5 w-44" placeholder={folder ? 'Heading (optional)' : 'Label'} />
      {folder ? (
        <span className="text-xs text-gray-400 flex-1 min-w-56" title="A folder / column has no page of its own — its links are the items beneath it.">folder — links below</span>
      ) : (
        <input value={it.url} onChange={(e) => onChange({ url: e.target.value })} className="border border-gray-300 rounded p-1.5 flex-1 min-w-56" placeholder="/classes or https://…" />
      )}
      <label className="text-xs text-gray-600 flex items-center gap-1">
        <input type="checkbox" checked={it.show} onChange={(e) => onChange({ show: e.target.checked })} /> show
      </label>
      {it.key && <span className="text-[10px] uppercase tracking-wide text-gray-400" title="Marked current on this portal page">{it.key}</span>}
      {onAddChild && (
        <button type="button" onClick={onAddChild} className="text-xs text-hgl-blue underline" title={folder ? 'Add a link under this folder' : 'Turn this into a folder with links beneath it'}>
          {folder ? '+ link inside' : 'make a folder'}
        </button>
      )}
      <button type="button" onClick={onRemove} className="text-xs text-red-600 underline">remove</button>
    </div>
  )
}

function List({ title, hint, items, onChange }: { title: string; hint: string; items: NavItem[]; onChange: (items: NavItem[]) => void }) {
  const set = (i: number, patch: Partial<NavItem>) => onChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it)))
  const swap = (arr: NavItem[], i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= arr.length) return arr
    const next = [...arr]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-hgl-slate">{title}</p>
      <p className="text-xs text-gray-500">{hint}</p>
      {items.map((it, i) => (
        <div key={i} className="space-y-2">
          <Row
            it={it}
            onChange={(p) => set(i, p)}
            onRemove={() => onChange(items.filter((_, k) => k !== i))}
            onMove={(d) => onChange(swap(items, i, d))}
            onAddChild={() => set(i, { url: '', children: [...(it.children ?? []), { label: '', url: '', show: true }] })}
          />
          {it.children?.map((c, j) => (
            <Row
              key={j}
              child
              it={c}
              onChange={(p) => set(i, { children: it.children!.map((x, k) => (k === j ? { ...x, ...p } : x)) })}
              onRemove={() => {
                const rest = it.children!.filter((_, k) => k !== j)
                set(i, rest.length ? { children: rest } : { children: undefined })
              }}
              onMove={(d) => set(i, { children: swap(it.children!, j, d) })}
            />
          ))}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { label: '', url: '', show: true }])} className="text-xs font-semibold text-hgl-blue underline">+ add an item</button>
    </div>
  )
}

export default function SiteNavPanel() {
  const [header, setHeader] = useState<NavItem[]>([])
  const [footer, setFooter] = useState<NavItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    fetch('/api/admin/contact-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.siteNav) {
          setHeader(j.siteNav.header)
          setFooter(j.siteNav.footer)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])
  async function save() {
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/admin/contact-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_site_nav', header, footer }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok && j.siteNav) {
      setHeader(j.siteNav.header)
      setFooter(j.siteNav.footer)
    }
    setMsg(res.ok ? 'Saved — every public page shows the new menu on its next load.' : `Error: ${j.error ?? res.status}`)
  }
  if (!loaded) return <p className="text-sm text-gray-500">Loading…</p>
  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-5" data-testid="site-nav-panel">
      <div>
        <h2 className="text-lg font-bold text-hgl-slate">Public site menu (header + footer)</h2>
        <p className="text-sm text-gray-500 mt-1">
          The shared header and footer on every public portal page mirror highergroundlearning.com. Edit these when the main site&apos;s menu changes — portal pages use site-relative links (/classes, /team, /inquire), main-site pages full URLs. Links open in the same tab. One level of nesting: a header folder (like &ldquo;Tutoring&rdquo;) or a footer column.
        </p>
      </div>
      <List title="Header" hint="Top-level items left to right; a folder opens a dropdown of its links." items={header} onChange={setHeader} />
      <List title="Footer" hint="Each folder is a column (its heading may be blank); plain items render as a single link." items={footer} onChange={setFooter} />
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="bg-hgl-blue text-white font-bold px-4 py-2 rounded-md disabled:opacity-50" data-testid="site-nav-save">
          {busy ? 'Saving…' : 'Save menu'}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}
