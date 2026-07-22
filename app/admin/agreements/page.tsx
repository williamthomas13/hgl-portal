'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { CollapsibleSection, DateHint } from '../ui'
import { ConfirmAction } from '../tutoring/confirm'

// Policy agreements admin (Phase 7e, docs/PHASE7_SPEC.md §12): per-family
// acceptance status (accepted vX on date + PDF snapshot, or not accepted +
// send/chase button), the "active tutoring but no accepted agreement" list
// that feeds the §12 invoice-generation warning, and the new-version flow
// (old acceptances remain valid records of what was agreed when). Reads run
// under staff RLS; mutations go through /api/admin/agreements.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

type Template = {
  id: string
  version: number
  body_markdown: string
  effective_date: string | null
  active: boolean
  created_at: string
}

type Acceptance = {
  id: string
  agreement_template_id: string
  family_id: string
  accepted_by_name: string
  accepted_at: string
  pdf_snapshot_path: string | null
  pdf_error: string | null
  version: number | null
}

type FamilyRow = {
  id: string
  name: string
  email: string | null
  activeTutoring: boolean
  hasTutoring: boolean
  chaseRound: number
  chaseRestartedAt: string | null
}

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/admin/agreements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return res.ok ? { ok: true, ...json } : { ok: false, error: json.error ?? 'Request failed.' }
}

// ---------------------------------------------------------------------------
// Per-family row actions
// ---------------------------------------------------------------------------

function FamilyRowView({
  family,
  acceptance,
  activeVersion,
  onChange,
  highlighted,
}: {
  family: FamilyRow
  acceptance: Acceptance | null
  activeVersion: number | null
  onChange: () => void
  highlighted?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function openPdf() {
    if (!acceptance) return
    setBusy(true)
    setErr(null)
    const res = await fetch(`/api/admin/agreements?acceptance=${acceptance.id}`)
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok || !json.url) return setErr(json.error ?? 'Could not open the PDF.')
    window.open(json.url, '_blank', 'noopener')
  }

  async function run(body: Record<string, unknown>, okMsg: string) {
    setBusy(true)
    setMsg(null)
    setErr(null)
    const res = await post(body)
    setBusy(false)
    if (!res.ok) return setErr(res.error ?? 'Failed.')
    setMsg(okMsg)
    onChange()
  }

  const outdated =
    acceptance && activeVersion != null && acceptance.version != null && acceptance.version < activeVersion

  return (
    <tr
      id={`family-${family.id}`}
      className={`border-b border-gray-100 align-top ${highlighted ? 'bg-amber-50' : ''}`}
    >
      <td className="py-2 pr-3">
        <span className="font-semibold text-hgl-slate">{family.name}</span>
        {family.email && <span className="block text-xs text-gray-400">{family.email}</span>}
      </td>
      <td className="py-2 pr-3 text-sm">
        {family.activeTutoring ? (
          <span className="text-emerald-700">Active tutoring</span>
        ) : family.hasTutoring ? (
          <span className="text-gray-500">Past tutoring</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="py-2 pr-3 text-sm">
        {acceptance ? (
          <>
            <span className="text-emerald-700 font-semibold">
              Accepted v{acceptance.version ?? '?'}
            </span>{' '}
            <span className="text-gray-500">
              by {acceptance.accepted_by_name}, {fmtDay(acceptance.accepted_at)}
            </span>
            {outdated && (
              <span className="ml-2 text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 font-semibold">
                current is v{activeVersion}
              </span>
            )}
          </>
        ) : (
          <span className="text-red-700 font-semibold">Not accepted</span>
        )}
      </td>
      <td className="py-2 text-sm text-right whitespace-nowrap space-x-3">
        {acceptance?.pdf_snapshot_path && (
          <button type="button" disabled={busy} onClick={openPdf} className="text-hgl-blue underline">
            PDF
          </button>
        )}
        {acceptance && !acceptance.pdf_snapshot_path && (
          <ConfirmAction
            label="Retry PDF"
            message={acceptance.pdf_error ?? 'The snapshot has not rendered yet.'}
            confirmLabel="Retry now"
            className="text-amber-700 underline"
            confirmClassName="text-amber-700 font-semibold underline"
            disabled={busy}
            onConfirm={() => run({ action: 'retry_pdf', acceptance_id: acceptance.id }, 'Snapshot rendered.')}
          />
        )}
        {(!acceptance || outdated) && family.email && (
          <ConfirmAction
            label={acceptance ? 'Send updated policy' : 'Send agreement link'}
            message={`Email the agreement link to ${family.email}?`}
            confirmLabel="Yes, send it"
            className="text-hgl-blue underline font-semibold"
            confirmClassName="text-hgl-blue font-semibold underline"
            disabled={busy}
            onConfirm={() => run({ action: 'send_link', family_id: family.id }, 'Link sent.')}
          />
        )}
        {/* PL-74: one click re-sends the agreement email and re-arms the
            +3d/+7d automatic nudges; rounds are tracked so the escalation
            can't become an infinite snooze. */}
        {!acceptance && family.email && (
          <ConfirmAction
            label="Restart automatic nudges"
            message={`Re-send the agreement to ${family.email} and re-arm the +3d/+7d chase (round ${family.chaseRound + 1})?`}
            confirmLabel="Restart the chase"
            className="text-amber-700 underline font-semibold"
            confirmClassName="text-amber-700 font-semibold underline"
            disabled={busy}
            onConfirm={() =>
              run({ action: 'restart_chase', family_id: family.id }, 'Chase restarted — nudges re-armed.')
            }
          />
        )}
        {family.chaseRestartedAt && (
          <span className="block text-xs text-gray-400">
            chase restarted {fmtDay(family.chaseRestartedAt)} (round {family.chaseRound + 1})
          </span>
        )}
        {msg && <span className="block text-xs text-green-700">{msg}</span>}
        {err && <span className="block text-xs text-red-600">{err}</span>}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// New-version flow
// ---------------------------------------------------------------------------

function VersionsPanel({
  templates,
  onChange,
}: {
  templates: Template[]
  onChange: () => void
}) {
  const active = templates.find((t) => t.active) ?? null
  const [draft, setDraft] = useState<string | null>(null) // null = editor closed
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [viewing, setViewing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function publish() {
    if (draft == null) return
    setBusy(true)
    setErr(null)
    const res = await post({ action: 'new_version', body_markdown: draft, effective_date: effectiveDate })
    setBusy(false)
    if (!res.ok) return setErr(res.error ?? 'Failed.')
    setDraft(null)
    onChange()
  }

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-1.5 pr-3">Version</th>
            <th className="py-1.5 pr-3">Effective</th>
            <th className="py-1.5 pr-3">Status</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-b border-gray-100">
              <td className="py-2 pr-3 font-semibold text-hgl-slate">v{t.version}</td>
              <td className="py-2 pr-3">{t.effective_date ?? '—'}</td>
              <td className="py-2 pr-3">
                {t.active ? (
                  <span className="text-emerald-700 font-semibold">Active</span>
                ) : (
                  <span className="text-gray-400">Superseded</span>
                )}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  className="text-hgl-blue underline text-xs"
                  onClick={() => setViewing(viewing === t.id ? null : t.id)}
                >
                  {viewing === t.id ? 'Hide text' : 'View text'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {viewing && (
        <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap max-h-80 overflow-y-auto">
          {templates.find((t) => t.id === viewing)?.body_markdown}
        </pre>
      )}

      {draft == null ? (
        <button
          type="button"
          className="bg-white border border-hgl-slate text-hgl-slate font-bold py-2 px-4 rounded-md hover:bg-gray-100 text-sm"
          onClick={() => setDraft(active?.body_markdown ?? '')}
        >
          Draft a new version…
        </button>
      ) : (
        <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
          <p className="text-sm text-gray-600">
            Publishing creates <strong>v{(templates[0]?.version ?? 0) + 1}</strong> and makes it the
            version new acceptances pin to. Existing acceptances stay valid records of the text
            their version contained — use the &quot;Send updated policy&quot; buttons above to ask
            families to re-accept.
          </p>
          <textarea
            className="block w-full border border-gray-300 rounded-md p-2 text-sm font-mono"
            rows={18}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Effective date</label>
              <input
                type="date"
                className="block border border-gray-300 rounded-md p-2 text-sm"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
              <DateHint value={effectiveDate} />
            </div>
            <ConfirmAction
              label={`Publish v${(templates[0]?.version ?? 0) + 1}`}
              message="Publish this as the active policy version?"
              confirmLabel="Yes, publish"
              className="bg-hgl-slate text-white font-bold py-2 px-4 rounded-md hover:opacity-90 text-sm"
              confirmClassName="text-red-700 font-semibold underline"
              disabled={busy}
              onConfirm={publish}
            />
            <button type="button" className="text-gray-500 underline text-sm" onClick={() => setDraft(null)}>
              Discard draft
            </button>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgreementsAdmin() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [acceptances, setAcceptances] = useState<Acceptance[]>([])
  const [families, setFamilies] = useState<FamilyRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)

  // PL-74: the escalation alert's button deep-links here with ?family= — the
  // row highlights and scrolls into view.
  const [highlightFamilyId, setHighlightFamilyId] = useState<string | null>(null)
  useEffect(() => {
    setHighlightFamilyId(new URLSearchParams(window.location.search).get('family'))
  }, [])
  useEffect(() => {
    if (!highlightFamilyId) return
    const el = document.getElementById(`family-${highlightFamilyId}`)
    if (el) el.scrollIntoView({ block: 'center' })
  })

  const load = useCallback(async () => {
    const [tplRes, accRes, engRes] = await Promise.all([
      supabase
        .from('agreement_templates')
        .select('id, version, body_markdown, effective_date, active, created_at')
        .eq('kind', 'scheduling_billing_policy')
        .order('version', { ascending: false }),
      supabase
        .from('agreement_acceptances')
        .select(
          `id, agreement_template_id, family_id, accepted_by_name, accepted_at,
           pdf_snapshot_path, pdf_error, agreement_templates ( version )`
        )
        .order('accepted_at', { ascending: false }),
      supabase
        .from('tutoring_engagements')
        .select(
          'status, students!inner ( family_id, families ( id, parent_first_name, parent_last_name, parent_email, agreement_chase_round, agreement_chase_restarted_at ) )'
        ),
    ])

    setTemplates((tplRes.data as Template[]) ?? [])
    setAcceptances(
      (((accRes.data as any[]) ?? []).map((a) => ({
        ...a,
        version: one<any>(a.agreement_templates)?.version ?? null,
      })) as Acceptance[])
    )

    // Families with tutoring (spec §12's audience), plus any family that has
    // an acceptance on record even without an engagement.
    const map = new Map<string, FamilyRow>()
    for (const e of (engRes.data as any[]) ?? []) {
      const fam = one<any>(one<any>(e.students)?.families)
      if (!fam?.id) continue
      const row = map.get(fam.id) ?? {
        id: fam.id,
        name: `${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim() || '(no name)',
        email: fam.parent_email ?? null,
        activeTutoring: false,
        hasTutoring: true,
        chaseRound: Number(fam.agreement_chase_round ?? 0),
        chaseRestartedAt: fam.agreement_chase_restarted_at ?? null,
      }
      if (e.status === 'active') row.activeTutoring = true
      map.set(fam.id, row)
    }
    const orphanFamilyIds = [
      ...new Set(
        (((accRes.data as any[]) ?? []).map((a) => a.family_id) as string[]).filter((id) => !map.has(id))
      ),
    ]
    if (orphanFamilyIds.length > 0) {
      const { data: extra } = await supabase
        .from('families')
        .select('id, parent_first_name, parent_last_name, parent_email, agreement_chase_round, agreement_chase_restarted_at')
        .in('id', orphanFamilyIds)
      for (const fam of (extra as any[]) ?? []) {
        map.set(fam.id, {
          id: fam.id,
          name: `${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim() || '(no name)',
          email: fam.parent_email ?? null,
          activeTutoring: false,
          hasTutoring: false,
          chaseRound: Number(fam.agreement_chase_round ?? 0),
          chaseRestartedAt: fam.agreement_chase_restarted_at ?? null,
        })
      }
    }
    setFamilies(
      [...map.values()].sort((a, b) => Number(b.activeTutoring) - Number(a.activeTutoring) || a.name.localeCompare(b.name))
    )
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshSignal])
  const refresh = () => setRefreshSignal((n) => n + 1)

  const activeVersion = templates.find((t) => t.active)?.version ?? null
  const latestByFamily = new Map<string, Acceptance>()
  for (const a of acceptances) {
    const existing = latestByFamily.get(a.family_id)
    if (!existing || (a.version ?? 0) > (existing.version ?? 0)) latestByFamily.set(a.family_id, a)
  }
  const unaccepted = families.filter((f) => f.activeTutoring && !latestByFamily.has(f.id))

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-hgl-slate">Policy agreements</h1>
            <p className="text-sm text-gray-500 mt-1">
              Who has accepted the scheduling &amp; billing policies, at a glance — with the signed
              PDF one click away. No more digging through Form responses.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <a href="/admin/leads" className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate">
              Leads
            </a>
            <a href="/admin" className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate">
              ← Back to admin
            </a>
          </div>
        </div>

        {!loaded ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            {unaccepted.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                <strong>
                  {unaccepted.length} famil{unaccepted.length === 1 ? 'y' : 'ies'} with active
                  tutoring but no accepted agreement:
                </strong>{' '}
                {unaccepted.map((f) => f.name).join(', ')} — use the send buttons below to chase.
              </div>
            )}

            <CollapsibleSection
              title="Families"
              subtitle={`${families.length} famil${families.length === 1 ? 'y' : 'ies'} · ${
                latestByFamily.size
              } accepted${activeVersion != null ? ` · current policy v${activeVersion}` : ''}`}
              defaultOpen
            >
              {families.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  No tutoring families yet — rows appear here as engagements are created.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                      <th className="py-1.5 pr-3">Family</th>
                      <th className="py-1.5 pr-3">Tutoring</th>
                      <th className="py-1.5 pr-3">Agreement</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {families.map((f) => (
                      <FamilyRowView
                        key={f.id}
                        family={f}
                        acceptance={latestByFamily.get(f.id) ?? null}
                        activeVersion={activeVersion}
                        onChange={refresh}
                        highlighted={f.id === highlightFamilyId}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Policy versions"
              subtitle="The text families accept — publish a new version when the policies change"
            >
              <VersionsPanel templates={templates} onChange={refresh} />
            </CollapsibleSection>
          </>
        )}
      </div>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
