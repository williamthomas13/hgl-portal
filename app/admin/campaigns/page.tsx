'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { CollapsibleSection } from '../ui'

// PL-201: Campaigns v1 — "an offer send is a query plus a compose." Chips
// compose with AND in plain English; the preview shows every recipient and
// WHY they matched, individually excludable — nobody sends to a list they
// haven't seen. Compose happens in the existing template editor (marketing
// category); the send batches through the quota-aware path and pauses rather
// than starving transactional email.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Recipient = { familyId: string; email: string; name: string; students: string[]; why: string[] }

const chipCls = (on: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
    on ? 'bg-hgl-slate text-white border-hgl-slate' : 'bg-white text-gray-600 border-gray-300 hover:border-hgl-slate'
  }`

export default function CampaignsPage() {
  const [segment, setSegment] = useState<any>({})
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([])
  const [classTypes, setClassTypes] = useState<string[]>([])
  const [templates, setTemplates] = useState<{ template_key: string; display_name: string }[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [quota, setQuota] = useState<{ cap: number; usedToday: number } | null>(null)
  const [preview, setPreview] = useState<{ recipients: Recipient[]; summary: string } | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [templateKey, setTemplateKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const loadLists = useCallback(async () => {
    const [schoolRes, typeRes, apiRes] = await Promise.all([
      supabase.from('schools').select('id, nickname, name').order('name'),
      supabase.from('classes').select('class_type'),
      fetch('/api/admin/campaigns').then((r) => r.json()),
    ])
    setSchools(((schoolRes.data as any[]) ?? []).map((s) => ({ id: s.id, name: s.nickname ?? s.name })))
    setClassTypes([...new Set(((typeRes.data as any[]) ?? []).map((c) => c.class_type))].sort())
    setTemplates(apiRes.templates ?? [])
    setCampaigns(apiRes.campaigns ?? [])
    setQuota(apiRes.quota ?? null)
  }, [])

  useEffect(() => {
    loadLists()
  }, [loadLists])

  const set = (k: string, v: any) => {
    setSegment((s: any) => {
      const next = { ...s }
      if (v === undefined || next[k] === v) delete next[k]
      else next[k] = v
      return next
    })
    setPreview(null) // a changed segment invalidates the seen list
    setExcluded(new Set())
  }

  async function runPreview() {
    setBusy(true)
    setMessage('')
    const res = await fetch('/api/admin/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preview', segment }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setMessage('Error: ' + (json.error ?? 'preview failed'))
    else {
      setPreview({ recipients: json.recipients, summary: json.summary })
      setQuota(json.quota)
      setExcluded(new Set())
    }
    setBusy(false)
  }

  const finalCount = preview ? preview.recipients.length - excluded.size : 0

  async function send() {
    if (!preview) return
    if (
      !window.confirm(
        `Send "${name.trim()}" to ${finalCount} famil${finalCount === 1 ? 'y' : 'ies'} (${preview.summary})? ` +
          `Marketing sends pause automatically if they'd crowd out regular emails.`
      )
    )
      return
    setBusy(true)
    setMessage('')
    const res = await fetch('/api/admin/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        name,
        segment,
        templateKey,
        excludeEmails: [...excluded],
        expectedCount: finalCount,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setMessage('Error: ' + (json.error ?? 'send failed'))
    else {
      setMessage(
        json.status === 'paused'
          ? `Sent ${json.sent} — paused at the daily cap; the remaining ${json.pendingLeft} go out automatically when the quota resets.`
          : `Done — ${json.sent} sent${json.suppressed ? `, ${json.suppressed} suppressed (unsubscribed)` : ''}${json.failed ? `, ${json.failed} failed` : ''}.`
      )
      setPreview(null)
      setName('')
      loadLists()
    }
    setBusy(false)
  }

  async function act(id: string, action: 'resume' | 'cancel') {
    setBusy(true)
    const res = await fetch('/api/admin/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    })
    const json = await res.json().catch(() => ({}))
    setMessage(res.ok ? (action === 'cancel' ? 'Campaign cancelled.' : `Resumed — ${json.sent} more sent.`) : 'Error: ' + json.error)
    setBusy(false)
    loadLists()
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-hgl-slate">Campaigns</h1>
          <p className="text-sm text-gray-500 mt-1">
            Pick who, see exactly who that is (and why), then send an offer — no cross-referencing.
            Compose the email itself on{' '}
            <a href="/admin/communications/templates" className="text-hgl-blue underline">
              the templates page
            </a>{' '}
            (marketing category).
          </p>
        </div>

        <CollapsibleSection title="New campaign" subtitle="Chips combine — every added chip narrows the list" defaultOpen accent="border-hgl-blue">
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <button className={chipCls(!!segment.tookClass)} onClick={() => set('tookClass', true)}>
                Took a class
              </button>
              <select
                value={segment.classType ?? ''}
                onChange={(e) => set('classType', e.target.value || undefined)}
                className="border border-gray-300 rounded-full px-3 py-1.5 text-xs bg-white"
              >
                <option value="">Any class type…</option>
                {classTypes.map((t) => (
                  <option key={t} value={t}>Took {t}</option>
                ))}
              </select>
              <select
                value={segment.schoolId ?? ''}
                onChange={(e) => set('schoolId', e.target.value || undefined)}
                className="border border-gray-300 rounded-full px-3 py-1.5 text-xs bg-white"
              >
                <option value="">Any school…</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>at {s.name}</option>
                ))}
              </select>
              <button className={chipCls(segment.currentStudent === true)} onClick={() => set('currentStudent', true)}>
                Current student
              </button>
              <button className={chipCls(segment.currentStudent === false)} onClick={() => set('currentStudent', false)}>
                Not currently enrolled
              </button>
              <button className={chipCls(segment.packageStatus === 'active')} onClick={() => set('packageStatus', 'active')}>
                Has package hours
              </button>
              <button className={chipCls(segment.packageStatus === 'exhausted')} onClick={() => set('packageStatus', 'exhausted')}>
                Package used up
              </button>
              <button className={chipCls(segment.packageStatus === 'never')} onClick={() => set('packageStatus', 'never')}>
                Never bought a package
              </button>
              <button className={chipCls(!!segment.waitlisted)} onClick={() => set('waitlisted', true)}>
                On a waitlist
              </button>
              <button className={chipCls(segment.serviceKind === 'tutoring')} onClick={() => set('serviceKind', 'tutoring')}>
                1-on-1 family
              </button>
              <button className={chipCls(segment.serviceKind === 'class_only')} onClick={() => set('serviceKind', 'class_only')}>
                Classes only
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={runPreview}
                disabled={busy}
                className="bg-hgl-slate text-white font-bold rounded px-4 py-2 text-sm disabled:opacity-40"
              >
                {busy && !preview ? 'Resolving…' : 'Preview recipients'}
              </button>
              {quota && (
                <span className="text-xs text-gray-500">
                  Email quota today: {quota.usedToday} of {quota.cap} used — marketing keeps a reserve so
                  invoices and schedules always send.
                </span>
              )}
            </div>

            {preview && (
              <>
                <p className="text-sm font-semibold text-hgl-slate">
                  {preview.summary} → {preview.recipients.length} famil{preview.recipients.length === 1 ? 'y' : 'ies'}
                  {excluded.size > 0 && ` (${excluded.size} unticked → sending to ${finalCount})`}
                </p>
                <div className="max-h-72 overflow-y-auto border border-gray-200 rounded">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-left text-gray-500">
                        <th className="p-2">Send</th>
                        <th className="p-2">Family</th>
                        <th className="p-2">Email</th>
                        <th className="p-2">Why they match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.recipients.map((r) => (
                        <tr key={r.email} className={excluded.has(r.email) ? 'opacity-40' : ''}>
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={!excluded.has(r.email)}
                              onChange={() =>
                                setExcluded((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(r.email)) next.delete(r.email)
                                  else next.add(r.email)
                                  return next
                                })
                              }
                            />
                          </td>
                          <td className="p-2 font-semibold text-hgl-slate whitespace-nowrap">
                            {r.name}
                            {r.students.length > 0 && (
                              <span className="text-gray-400 font-normal"> ({r.students.join(', ')})</span>
                            )}
                          </td>
                          <td className="p-2">{r.email}</td>
                          <td className="p-2 text-gray-600">{r.why.join(' · ')}</td>
                        </tr>
                      ))}
                      {preview.recipients.length === 0 && (
                        <tr><td colSpan={4} className="p-3 text-gray-500 italic">Nobody matches this combination.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Campaign name (internal)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="border border-gray-300 rounded p-2 text-sm flex-1 min-w-48"
                  />
                  <select
                    value={templateKey}
                    onChange={(e) => setTemplateKey(e.target.value)}
                    className="border border-gray-300 rounded p-2 text-sm bg-white"
                  >
                    <option value="">Template…</option>
                    {templates.map((t) => (
                      <option key={t.template_key} value={t.template_key}>{t.display_name}</option>
                    ))}
                  </select>
                  <button
                    onClick={send}
                    disabled={busy || finalCount === 0 || !name.trim() || !templateKey}
                    className="bg-hgl-blue text-white font-bold rounded px-4 py-2 text-sm disabled:opacity-40"
                  >
                    Send to {finalCount}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">
                  Test-send the template to yourself from the templates page first. Every campaign email
                  carries one-click unsubscribe and our mailing address, and sends from the offers identity —
                  never the operational one.
                </p>
              </>
            )}
            {message && (
              <p className={`text-sm ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Past campaigns" subtitle="Every send logged — segment, list, per-recipient status" defaultOpen>
          {campaigns.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No campaigns yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {campaigns.map((c) => (
                <li key={c.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-hgl-slate">{c.name}</span>
                  <span className="text-xs text-gray-500">{c.segmentSummary}</span>
                  <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                    c.status === 'done' ? 'bg-green-100 text-green-700'
                      : c.status === 'paused' ? 'bg-amber-100 text-amber-800'
                        : c.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
                          : 'bg-blue-100 text-blue-700'
                  }`}>
                    {c.status === 'paused' ? 'paused at the cap' : c.status}
                  </span>
                  <span className="text-xs text-gray-500">
                    {c.counts.sent} sent
                    {c.counts.pending > 0 && ` · ${c.counts.pending} waiting`}
                    {c.counts.suppressed > 0 && ` · ${c.counts.suppressed} unsubscribed`}
                    {c.counts.failed > 0 && ` · ${c.counts.failed} failed`}
                    {c.counts.excluded > 0 && ` · ${c.counts.excluded} unticked`}
                  </span>
                  {c.status === 'paused' && (
                    <>
                      <button onClick={() => act(c.id, 'resume')} disabled={busy} className="text-xs text-hgl-blue underline">
                        try to resume now
                      </button>
                      <button onClick={() => act(c.id, 'cancel')} disabled={busy} className="text-xs text-red-600 underline">
                        cancel the rest
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>
      </div>
    </div>
  )
}
