'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { CollapsibleSection } from '../ui'
import { ConfirmAction } from '../tutoring/confirm'

// Lead pipeline (Phase 7e, docs/PHASE7_SPEC.md §11) — replaces the Ops
// Director's "pending students" spreadsheet. Reads run in the browser under
// staff RLS; mutations go through /api/admin/leads. Grouped by pipeline
// status with a staleness badge ("no touch in 4+ days") so the inbox-reality
// and the tracker stop being two places.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Lead = {
  id: string
  source: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  student_name: string | null
  student_school: string | null
  student_grade: string | null
  interest: string
  subjects: string | null
  test_date: string | null
  prior_scores: string | null
  availability_text: string | null
  online_preference: string | null
  offer_id: string | null
  status: string
  assigned_to: string | null
  consult_at: string | null
  consult_owner_email: string | null
  consult_gcal_event_id: string | null
  notes: string | null
  intake_token_sent_at: string | null
  intake_completed_at: string | null
  intake: Record<string, any> | null
  family_id: string | null
  student_id: string | null
  created_at: string
  updated_at: string
}

type Offer = {
  id: string
  name: string
  kind: string
  value: number
  active: boolean
  notes: string | null
}

const STATUS_ORDER = [
  'new',
  'contacted',
  'intake_sent',
  'intake_complete',
  'consult_scheduled',
  'consult_done',
  'proposal_sent',
  'scheduled',
  'lost',
] as const

// Plain English, never raw enum values (house rule).
const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  intake_sent: 'Intake form sent',
  intake_complete: 'Intake complete',
  consult_scheduled: 'Consult scheduled',
  consult_done: 'Consult done',
  proposal_sent: 'Proposal sent',
  scheduled: 'Scheduled — won',
  lost: 'Lost',
}

const SOURCE_LABELS: Record<string, string> = {
  website: 'Website',
  referral: 'Referral',
  call: 'Phone call',
  other: 'Other',
}

const INTEREST_LABELS: Record<string, string> = {
  test_prep: 'Test prep',
  subject: 'Subject tutoring',
  unsure: 'Not sure yet',
}

const ONLINE_LABELS: Record<string, string> = {
  online: 'Online',
  in_person: 'In person',
  either: 'Either',
}

const OFFER_KIND_LABELS: Record<string, string> = {
  free_hours: 'Free hours',
  percent_off_first_month: '% off first month',
  fixed_credit: 'Fixed credit ($)',
}

const STALE_DAYS = 4
const inputCls = 'block w-full border border-gray-300 rounded-md p-2 text-sm'

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

function isStale(lead: Lead): boolean {
  if (lead.status === 'scheduled' || lead.status === 'lost') return false
  return Date.now() - new Date(lead.updated_at).getTime() > STALE_DAYS * 86_400_000
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; gcal?: string }> {
  const res = await fetch('/api/admin/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return res.ok ? { ok: true, ...json } : { ok: false, error: json.error ?? 'Request failed.' }
}

// ---------------------------------------------------------------------------
// New-lead form
// ---------------------------------------------------------------------------

function NewLeadForm({ onCreated }: { onCreated: () => void }) {
  const blank = {
    source: 'call',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    student_name: '',
    student_school: '',
    student_grade: '',
    interest: 'unsure',
    subjects: '',
    notes: '',
  }
  const [f, setF] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof blank) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await post({ action: 'create', ...f })
    setSaving(false)
    if (!res.ok) return setError(res.error ?? 'Failed.')
    setF(blank)
    onCreated()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Source</label>
          <select className={`${inputCls} bg-white`} value={f.source} onChange={(e) => set('source')(e.target.value)}>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Contact name</label>
          <input className={inputCls} value={f.contact_name} onChange={(e) => set('contact_name')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Contact email</label>
          <input className={inputCls} type="email" value={f.contact_email} onChange={(e) => set('contact_email')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Contact phone</label>
          <input className={inputCls} value={f.contact_phone} onChange={(e) => set('contact_phone')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Student name</label>
          <input className={inputCls} value={f.student_name} onChange={(e) => set('student_name')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">School</label>
          <input className={inputCls} value={f.student_school} onChange={(e) => set('student_school')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Grade</label>
          <input className={inputCls} value={f.student_grade} onChange={(e) => set('student_grade')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Interest</label>
          <select className={`${inputCls} bg-white`} value={f.interest} onChange={(e) => set('interest')(e.target.value)}>
            {Object.entries(INTEREST_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Subject(s) / test</label>
          <input className={inputCls} placeholder="e.g. SAT / Algebra 2" value={f.subjects} onChange={(e) => set('subjects')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
          <input className={inputCls} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="bg-hgl-slate text-white font-bold py-2 px-5 rounded-md hover:opacity-90 disabled:opacity-50 text-sm"
      >
        {saving ? 'Adding…' : 'Add lead'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Lead detail (expanded row)
// ---------------------------------------------------------------------------

function IntakeAnswers({ intake }: { intake: Record<string, any> }) {
  const row = (label: string, value: unknown) =>
    value ? (
      <div className="flex gap-2">
        <span className="text-gray-400 whitespace-nowrap">{label}:</span>
        <span className="text-gray-700">{String(value)}</span>
      </div>
    ) : null
  return (
    <div className="text-xs space-y-1 bg-slate-50 border border-slate-200 rounded p-3">
      <p className="font-semibold text-hgl-slate text-sm mb-1">Intake answers</p>
      {row('Student', `${intake.studentFirst ?? ''} ${intake.studentLast ?? ''}`.trim())}
      {row('Student phone', intake.studentPhone)}
      {row('Student email', intake.studentEmail)}
      {row('School / grade', [intake.school, intake.grade].filter(Boolean).join(' · '))}
      {row('Guardian', `${intake.guardianFirst ?? ''} ${intake.guardianLast ?? ''}`.trim())}
      {row('Guardian phone', intake.guardianPhone)}
      {row('Guardian email', intake.guardianEmail)}
      {row('Second guardian', [intake.guardian2Name, intake.guardian2Phone, intake.guardian2Email].filter(Boolean).join(' · '))}
      {row('Preferred contact', intake.preferredContactMethod)}
      {row(
        "If student hasn't arrived",
        intake.absentContactWho
          ? `${intake.absentContactHow ?? 'contact'} the ${intake.absentContactWho}`
          : null
      )}
      {row('Emergency contact', [intake.emergencyName, intake.emergencyPhone, intake.emergencyRelation].filter(Boolean).join(' · '))}
      {row('How they heard', intake.howHeard)}
      {row('Reason for coming', intake.reason)}
      {row('Special needs / allergies', intake.specialNeeds)}
      {row('Focus', INTEREST_LABELS[intake.interest] ?? intake.interest)}
      {row('Test & date', intake.testDate)}
      {row('Prior scores', intake.priorScores)}
      {row('Subject needed', intake.subjects)}
      {row('Availability', intake.availabilityText)}
      {row('Online / in person', ONLINE_LABELS[intake.onlinePreference] ?? intake.onlinePreference)}
    </div>
  )
}

function LeadDetail({
  lead,
  offers,
  onChange,
}: {
  lead: Lead
  offers: Offer[]
  onChange: () => void
}) {
  const [status, setStatus] = useState(lead.status)
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to ?? '')
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [offerId, setOfferId] = useState(lead.offer_id ?? '')
  const [consultAt, setConsultAt] = useState(() => {
    if (!lead.consult_at) return ''
    // datetime-local wants LOCAL wall time, not the UTC slice.
    const d = new Date(lead.consult_at)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  })
  const [consultOwner, setConsultOwner] = useState(lead.consult_owner_email ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function run(body: Record<string, unknown>, okMsg: string) {
    setBusy(true)
    setMsg(null)
    setErr(null)
    const res = await post(body)
    setBusy(false)
    if (!res.ok) return setErr(res.error ?? 'Failed.')
    setMsg(res.gcal === 'failed' ? `${okMsg} (Google Calendar push failed — event not created)` : okMsg)
    onChange()
  }

  const activeOffers = offers.filter((o) => o.active || o.id === lead.offer_id)

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
          <select className={`${inputCls} bg-white`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Assigned to (staff email)</label>
          <input className={inputCls} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Offer</label>
          <select className={`${inputCls} bg-white`} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
            <option value="">No offer</option>
            {activeOffers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(
              {
                action: 'update',
                id: lead.id,
                status,
                assigned_to: assignedTo,
                notes,
                offer_id: offerId || null,
              },
              'Saved.'
            )
          }
          className="bg-hgl-slate text-white font-bold py-1.5 px-4 rounded-md hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        {lead.contact_email ? (
          <ConfirmAction
            label={lead.intake_token_sent_at ? 'Re-send intake form' : 'Send intake form'}
            message={`Email the intake form link to ${lead.contact_email}?`}
            confirmLabel="Yes, send it"
            className="text-hgl-blue underline font-semibold"
            confirmClassName="text-hgl-blue font-semibold underline"
            disabled={busy}
            onConfirm={() => run({ action: 'send_intake', id: lead.id }, 'Intake form sent.')}
          />
        ) : (
          <span className="text-xs text-gray-400">Add a contact email to send the intake form</span>
        )}
        {lead.status !== 'lost' && (
          <ConfirmAction
            label="Mark lost"
            message="Move this lead to Lost?"
            confirmLabel="Yes, mark lost"
            className="text-gray-500 underline"
            disabled={busy}
            onConfirm={() => run({ action: 'update', id: lead.id, status: 'lost' }, 'Marked lost.')}
          />
        )}
      </div>

      {/* Consult scheduling light (spec §11): datetime + owner → GCal push */}
      <div className="bg-gray-50 border border-gray-200 rounded p-3">
        <p className="text-xs font-semibold text-gray-600 mb-2">
          Consultation
          {lead.consult_at && (
            <span className="ml-2 font-normal text-gray-500">
              currently {fmtWhen(lead.consult_at)} with {lead.consult_owner_email ?? '—'}
              {lead.consult_gcal_event_id ? ' · on their Google Calendar' : ''}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date &amp; time</label>
            <input
              type="datetime-local"
              className={inputCls}
              value={consultAt}
              onChange={(e) => setConsultAt(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Owner (their Workspace email)</label>
            <input
              className={inputCls}
              placeholder="eric@highergroundlearning.com"
              value={consultOwner}
              onChange={(e) => setConsultOwner(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy || !consultAt || !consultOwner}
            onClick={() =>
              run(
                {
                  action: 'schedule_consult',
                  id: lead.id,
                  consult_at: new Date(consultAt).toISOString(),
                  consult_owner_email: consultOwner.trim().toLowerCase(),
                },
                'Consult scheduled.'
              )
            }
            className="bg-white border border-hgl-slate text-hgl-slate font-bold py-1.5 px-4 rounded-md hover:bg-gray-100 disabled:opacity-50"
          >
            {lead.consult_at ? 'Update consult' : 'Schedule consult'}
          </button>
        </div>
      </div>

      {lead.intake && <IntakeAnswers intake={lead.intake} />}
      {lead.family_id && (
        <p className="text-xs text-gray-500">
          Converted: family and student records exist — schedule them from{' '}
          <a href="/admin/tutoring" className="text-hgl-blue underline">the tutoring page</a>.
        </p>
      )}

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Offers panel (spec §11: the mechanism exists; nothing active at launch)
// ---------------------------------------------------------------------------

function OffersPanel({ offers, onChange }: { offers: Offer[]; onChange: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('free_hours')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const res = await post({ action: 'create_offer', name, kind, value: Number(value) })
    setBusy(false)
    if (!res.ok) return setErr(res.error ?? 'Failed.')
    setName('')
    setValue('')
    onChange()
  }

  return (
    <div className="space-y-4">
      {offers.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          No offers exist — that&apos;s expected at launch (the old &quot;2 free hours&quot; website
          offer is retired). Create one here when a promotion comes back; active offers can then be
          attached to leads and materialize on the first invoice.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-1.5 pr-3">Offer</th>
              <th className="py-1.5 pr-3">Type</th>
              <th className="py-1.5 pr-3">Value</th>
              <th className="py-1.5 pr-3">Status</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id} className="border-b border-gray-100">
                <td className="py-2 pr-3 font-semibold text-hgl-slate">{o.name}</td>
                <td className="py-2 pr-3">{OFFER_KIND_LABELS[o.kind] ?? o.kind}</td>
                <td className="py-2 pr-3">
                  {o.kind === 'percent_off_first_month' ? `${o.value}%` : o.kind === 'fixed_credit' ? `$${o.value}` : `${o.value} hrs`}
                </td>
                <td className="py-2 pr-3">{o.active ? 'Active' : 'Inactive'}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    className="text-hgl-blue underline text-xs"
                    onClick={async () => {
                      await post({ action: 'update_offer', id: o.id, active: !o.active })
                      onChange()
                    }}
                  >
                    {o.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Name</label>
          <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2 free hours" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Type</label>
          <select className={`${inputCls} bg-white`} value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(OFFER_KIND_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Value</label>
          <input className={inputCls} required type="number" step="0.5" min="0" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="bg-hgl-slate text-white font-bold py-2 px-4 rounded-md hover:opacity-90 disabled:opacity-50 text-sm"
        >
          Create offer
        </button>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeadsAdmin() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)

  const load = useCallback(async () => {
    const [leadsRes, offersRes] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('tutoring_offers').select('*').order('created_at', { ascending: false }),
    ])
    setLeads((leadsRes.data as Lead[]) ?? [])
    setOffers((offersRes.data as Offer[]) ?? [])
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshSignal])
  const refresh = () => setRefreshSignal((n) => n + 1)

  const open = leads.filter((l) => l.status !== 'scheduled' && l.status !== 'lost')
  const staleCount = open.filter(isStale).length
  const visibleStatuses = STATUS_ORDER.filter((s) =>
    showClosed ? true : s !== 'scheduled' && s !== 'lost'
  )

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-hgl-slate">Leads &amp; intake</h1>
            <p className="text-sm text-gray-500 mt-1">
              Every inquiry in one pipeline — send the intake form, schedule the consult, and
              hand off to scheduling without a spreadsheet.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <a href="/admin/agreements" className="text-sm font-semibold text-hgl-blue underline hover:text-hgl-slate">
              Agreements
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
            <CollapsibleSection title="Add a lead" accent="border-hgl-blue">
              <NewLeadForm onCreated={refresh} />
            </CollapsibleSection>

            <CollapsibleSection
              title="Pipeline"
              subtitle={`${open.length} open lead${open.length === 1 ? '' : 's'}${
                staleCount > 0 ? ` · ${staleCount} untouched for ${STALE_DAYS}+ days` : ''
              }`}
              defaultOpen
            >
              <label className="flex items-center gap-2 text-xs text-gray-500 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showClosed}
                  onChange={(e) => setShowClosed(e.target.checked)}
                />
                Show won &amp; lost leads
              </label>
              {open.length === 0 && !showClosed && (
                <p className="text-sm text-gray-500 italic">No open leads — nice and quiet.</p>
              )}
              <div className="space-y-6">
                {visibleStatuses.map((status) => {
                  const group = leads.filter((l) => l.status === status)
                  if (group.length === 0) return null
                  return (
                    <div key={status}>
                      <h3 className="text-sm font-bold text-hgl-slate uppercase tracking-wide mb-2">
                        {STATUS_LABELS[status]}{' '}
                        <span className="text-gray-400 font-normal">({group.length})</span>
                      </h3>
                      <div className="space-y-2">
                        {group.map((lead) => (
                          <div key={lead.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                            <button
                              type="button"
                              className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1"
                              onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                            >
                              <span className="font-semibold text-hgl-slate">
                                {lead.student_name || lead.contact_name || lead.contact_email || 'Unnamed lead'}
                              </span>
                              {lead.student_name && lead.contact_name && (
                                <span className="text-sm text-gray-500">{lead.contact_name}</span>
                              )}
                              <span className="text-xs text-gray-400">
                                {SOURCE_LABELS[lead.source] ?? lead.source} ·{' '}
                                {INTEREST_LABELS[lead.interest] ?? lead.interest}
                                {lead.subjects ? ` · ${lead.subjects}` : ''} · added {fmtDay(lead.created_at)}
                              </span>
                              {lead.assigned_to && (
                                <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                                  {lead.assigned_to.split('@')[0]}
                                </span>
                              )}
                              {lead.consult_at && (
                                <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">
                                  consult {fmtWhen(lead.consult_at)}
                                </span>
                              )}
                              {lead.offer_id && (
                                <span className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">
                                  {offers.find((o) => o.id === lead.offer_id)?.name ?? 'offer'}
                                </span>
                              )}
                              {isStale(lead) && (
                                <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 font-semibold">
                                  no touch in {STALE_DAYS}+ days
                                </span>
                              )}
                              <span className="ml-auto text-gray-400 text-sm">
                                {expanded === lead.id ? '▾' : '▸'}
                              </span>
                            </button>
                            {expanded === lead.id && (
                              <LeadDetail lead={lead} offers={offers} onChange={refresh} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Offers"
              subtitle="Promotions that can be attached to a lead — none active at launch"
            >
              <OffersPanel offers={offers} onChange={refresh} />
            </CollapsibleSection>
          </>
        )}
      </div>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
