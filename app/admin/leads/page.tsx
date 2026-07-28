'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDeepLinkFocus } from '../ui'
import { supabase } from '../../utils/supabase'
import { CollapsibleSection } from '../ui'
import { ConfirmAction } from '../tutoring/confirm'
import { LEAD_STATUS_LABELS } from '../../utils/lead-assign-copy'

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
  /** PL-189: 'scheduled' (calendar meeting) or 'phone' (recorded after the fact). */
  consult_mode: string | null
  notes: string | null
  intake_token_sent_at: string | null
  lost_reason_kind: string | null
  lost_reason: string | null
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
// PL-174: one label map, shared with the assignment email's composer.
const STATUS_LABELS = LEAD_STATUS_LABELS

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

// PL-108: closing a lead requires a reason — quick-pick + optional detail
// (detail required for 'other').
const LOST_REASONS: Record<string, string> = {
  price: 'Price',
  timing: 'Timing',
  went_elsewhere: 'Went elsewhere',
  no_response: 'No response',
  other: 'Other',
}

function promptCloseReason(): { kind: string; text: string | null } | null {
  const pick = prompt(
    'Why "not now"? Type one:\n\nprice · timing · went elsewhere · no response · other'
  )
  if (pick == null) return null
  const kind = pick.trim().toLowerCase().replace(/\s+/g, '_')
  if (!LOST_REASONS[kind]) {
    alert('Please type one of: price, timing, went elsewhere, no response, other.')
    return null
  }
  const text = prompt(kind === 'other' ? 'A few words on why (required):' : 'Anything worth noting? (optional)')
  if (kind === 'other' && !(text ?? '').trim()) {
    alert('For "other", a few words are required.')
    return null
  }
  return { kind, text: (text ?? '').trim() || null }
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
// PL-182: ONE add-prospective-student form (Scarlett, Jul 27) — the separate
// "on a phone call" quick add and the full form were the same thing with an
// arbitrary wall between them. Everything except enough-to-identify-them is
// optional: Kelsie enters whatever she has at the time, and the intake sheet
// (where completeness is actually enforced) fills in the rest. Partial entry
// is the NORMAL case here, not an error state — no required-field noise.
// ---------------------------------------------------------------------------

function NewLeadForm({ onCreated }: { onCreated: (id: string) => void }) {
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
  // The bare minimum: enough to identify them — a name (parent or student)
  // or an email. Same rule the server enforces.
  const identified = !!(f.contact_name.trim() || f.contact_email.trim() || f.student_name.trim())

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await post({ action: 'create', ...f })
    setSaving(false)
    if (!res.ok) return setError(res.error ?? 'Failed.')
    setF(blank)
    onCreated((res as { id?: string }).id ?? '')
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* Who they are — the only part that's ever needed. Mid-call, type a
          name, hit Add, done; the rest of the form is there when you have it. */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Parent / contact name</label>
          <input className={inputCls} autoFocus value={f.contact_name} onChange={(e) => set('contact_name')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
          <input className={inputCls} type="tel" value={f.contact_phone} onChange={(e) => set('contact_phone')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
          <input className={inputCls} type="email" value={f.contact_email} onChange={(e) => set('contact_email')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Student name</label>
          <input className={inputCls} value={f.student_name} onChange={(e) => set('student_name')(e.target.value)} />
        </div>
      </div>
      {/* Everything below is optional — the intake sheet fills whatever's
          missing, so blank fields here are normal, not a problem. */}
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
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !identified}
          className="bg-hgl-slate text-white font-bold py-2 px-5 rounded-md hover:opacity-90 disabled:opacity-50 text-sm"
        >
          {saving ? 'Adding…' : 'Add to pipeline'}
        </button>
        <span className="text-xs text-gray-400">
          {identified
            ? 'Whatever you have right now is enough — the intake sheet fills in the rest.'
            : 'Just a name (or an email) is enough to start.'}
        </span>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// PL-109: the pipeline's job is moving students toward tutoring — every
// status carries its one obvious next move as a button on the row.
function NextStepButton({ lead, onChange }: { lead: Lead; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const act = async (e: React.MouseEvent, body: Record<string, unknown>, okMsg: string) => {
    e.stopPropagation()
    setBusy(true)
    const res = await post(body)
    setBusy(false)
    if (!res.ok) alert(res.error ?? 'Failed.')
    else onChange()
    void okMsg
  }
  const cls = 'text-xs font-semibold text-white bg-hgl-blue rounded px-2.5 py-1 hover:opacity-90 disabled:opacity-50'
  const studentFirst = (lead.student_name ?? '').split(' ')[0] || 'the student'

  if (lead.status === 'new' || lead.status === 'contacted') {
    if (!lead.contact_email) return <span className="text-xs text-gray-400" onClick={stop}>next: get a contact email</span>
    return (
      <button type="button" disabled={busy} className={cls}
        onClick={(e) => { e.stopPropagation(); if (confirm(`Email the intake form link to ${lead.contact_email}?`)) act(e, { action: 'send_intake', id: lead.id }, 'sent') }}>
        Send intake form
      </button>
    )
  }
  if (lead.status === 'intake_sent') {
    return (
      <button type="button" disabled={busy} className={cls}
        onClick={(e) => { e.stopPropagation(); if (confirm(`Re-send the intake form link to ${lead.contact_email}?`)) act(e, { action: 'send_intake', id: lead.id }, 'sent') }}>
        Re-send intake form
      </button>
    )
  }
  // PL-188: once the proposal is out, the row says so — the blue Schedule
  // button persisting past proposing was the "stale action" finding.
  if (lead.status === 'proposal_sent') {
    return (
      <a
        href={lead.student_id ? `/admin/tutoring?schedule=${lead.student_id}` : '#'}
        onClick={stop}
        className="text-xs text-amber-700 font-semibold underline"
        title="Waiting on the family to confirm — Started happens on confirmation"
      >
        proposal sent — waiting on the family
      </a>
    )
  }
  if (['intake_complete', 'consult_done'].includes(lead.status)) {
    // Scheduling IS the next step — the wizard preload deep-link (PL-92
    // pattern applied inside the app). Without a student record yet, the
    // detail's "Create family + student" is the gateway.
    if (lead.student_id) {
      return (
        <a href={`/admin/tutoring?schedule=${lead.student_id}`} onClick={stop} className={cls}>
          Schedule {studentFirst}
        </a>
      )
    }
    return <span className="text-xs text-gray-400" onClick={stop}>next: create family + student (open the row)</span>
  }
  if (lead.status === 'consult_scheduled') {
    return (
      <button type="button" disabled={busy} className={cls}
        onClick={(e) => act(e, { action: 'update', id: lead.id, status: 'consult_done' }, 'done')}>
        Mark consult done
      </button>
    )
  }
  if (lead.status === 'scheduled' && lead.student_id) {
    return (
      <a href={`/admin/tutoring?family=${lead.family_id ?? ''}`} onClick={stop} className="text-xs text-gray-500 underline">
        see the schedule
      </a>
    )
  }
  return null
}

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
  // PL-174: the field collapses to a small affordance; empty is normal.
  const [assignOpen, setAssignOpen] = useState(false)
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [offerId, setOfferId] = useState(lead.offer_id ?? '')
  const [consultAt, setConsultAt] = useState(() => {
    if (!lead.consult_at) return ''
    // datetime-local wants LOCAL wall time, not the UTC slice.
    const d = new Date(lead.consult_at)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  })
  const [consultOwner, setConsultOwner] = useState(lead.consult_owner_email ?? '')
  // PL-189: the phone-consult second door (defaults to today).
  const [phoneConsultDate, setPhoneConsultDate] = useState(() =>
    new Date().toLocaleDateString('en-CA')
  )
  const [phoneConsultNotes, setPhoneConsultNotes] = useState('')
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
      {lead.status === 'lost' && lead.lost_reason_kind && (
        <p className="text-xs text-gray-500">
          Closed — not now: <span className="font-semibold">{LOST_REASONS[lead.lost_reason_kind] ?? lead.lost_reason_kind}</span>
          {lead.lost_reason ? ` — ${lead.lost_reason}` : ''}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
          <select className={`${inputCls} bg-white`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
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
      {/* PL-174: assignment is optional and quiet — empty is the normal
          state; assigning someone ELSE emails them the lead's key facts. */}
      <div className="text-xs text-gray-500">
        {assignOpen ? (
          <span className="inline-flex items-center gap-2 flex-wrap">
            <input
              className="border border-gray-300 rounded p-1 text-xs w-64"
              placeholder="staff email"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              className="text-hgl-blue font-semibold underline"
              onClick={() => {
                setAssignOpen(false)
                run(
                  { action: 'update', id: lead.id, assigned_to: assignedTo.trim() },
                  assignedTo.trim() ? `Assigned to ${assignedTo.trim()} — they get one email with the lead.` : 'Unassigned.'
                )
              }}
            >
              save
            </button>
            <button type="button" className="underline" onClick={() => setAssignOpen(false)}>
              cancel
            </button>
            <span className="text-gray-400">
              Assigning someone else emails them the lead — assigning yourself stays silent.
            </span>
          </span>
        ) : lead.assigned_to ? (
          <span>
            Assigned to <span className="font-semibold text-gray-600">{lead.assigned_to}</span>{' '}
            <button type="button" className="underline text-hgl-blue" onClick={() => setAssignOpen(true)}>
              change
            </button>
          </span>
        ) : (
          <button type="button" className="underline text-gray-400" onClick={() => setAssignOpen(true)}>
            assign…
          </button>
        )}
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            // PL-108: picking "Closed — not now" in the dropdown also
            // requires the reason before saving.
            const closing = status === 'lost' && lead.status !== 'lost'
            const reason = closing ? promptCloseReason() : null
            if (closing && !reason) return
            run(
              {
                action: 'update',
                id: lead.id,
                status,
                // PL-174: assignment has its own affordance + save — the main
                // Save never touches it (a typed-then-cancelled email must
                // not assign on an unrelated save).
                notes,
                offer_id: offerId || null,
                ...(reason ? { lost_reason_kind: reason.kind, lost_reason: reason.text } : {}),
              },
              'Saved.'
            )
          }}
          className="bg-hgl-slate text-white font-bold py-1.5 px-4 rounded-md hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        {lead.intake ? (
          // PL-188: intake is COMPLETE — offering a re-send next to the
          // visible answers implied the state was unknown. The answers
          // render just below.
          <span className="text-xs text-green-700 font-semibold">
            ✓ Intake complete — answers below
          </span>
        ) : lead.contact_email ? (
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
          <button
            type="button"
            disabled={busy}
            className="text-gray-500 underline"
            onClick={() => {
              // PL-108: never closed without a reason.
              const reason = promptCloseReason()
              if (!reason) return
              run(
                { action: 'update', id: lead.id, status: 'lost', lost_reason_kind: reason.kind, lost_reason: reason.text },
                'Closed — not now (reason saved).'
              )
            }}
          >
            Close — not now…
          </button>
        )}
      </div>

      {/* Consult scheduling light (spec §11): datetime + owner → GCal push.
          PL-188: past the proposal, consultation is a step backward — greyed
          with a plain reason, not hidden, so the sequence stays legible. */}
      <div
        className={`bg-gray-50 border border-gray-200 rounded p-3 ${
          ['proposal_sent', 'scheduled'].includes(lead.status) ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <p className="text-xs font-semibold text-gray-600 mb-2">
          Consultation
          {['proposal_sent', 'scheduled'].includes(lead.status) && (
            <span className="ml-2 font-normal text-amber-700">
              proposal already sent — the consultation moment has passed
            </span>
          )}
          {lead.consult_at && (
            <span className="ml-2 font-normal text-gray-500">
              currently {fmtWhen(lead.consult_at)} with {lead.consult_owner_email ?? '—'}
              {lead.consult_mode === 'phone'
                ? ' · by phone (already happened — no calendar event)'
                : lead.consult_gcal_event_id
                  ? ' · on their Google Calendar'
                  : ''}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date &amp; time</label>
            <input
              type="datetime-local"
              step={300}
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
        {/* PL-189: the second door — the consultation just HAPPENED on the
            phone. A record, not an appointment: no calendar event, no
            scheduling machinery; the pipeline advances exactly as if a
            scheduled consultation had completed. */}
        <div className="mt-3 pt-3 border-t border-gray-200 flex flex-wrap items-end gap-3">
          <span className="text-xs text-gray-500 w-full">
            …or it already happened on the phone:
          </span>
          <div>
            <label className="block text-xs text-gray-500 mb-1">When</label>
            <input type="date" className={inputCls} value={phoneConsultDate} onChange={(e) => setPhoneConsultDate(e.target.value)} />
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
            <input
              className={inputCls}
              placeholder="e.g. wants SAT prep before the October test"
              value={phoneConsultNotes}
              onChange={(e) => setPhoneConsultNotes(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busy || !phoneConsultDate}
            onClick={() =>
              run(
                {
                  action: 'record_phone_consult',
                  id: lead.id,
                  happened_at: new Date(phoneConsultDate + 'T12:00:00').toISOString(),
                  notes: phoneConsultNotes.trim() || undefined,
                },
                'Phone consult recorded — no calendar event, pipeline advanced.'
              )
            }
            className="bg-white border border-gray-400 text-gray-700 font-bold py-1.5 px-4 rounded-md hover:bg-gray-100 disabled:opacity-50"
          >
            Record phone consult
          </button>
        </div>
      </div>

      {lead.intake && <IntakeAnswers intake={lead.intake} />}
      {lead.family_id ? (
        <p className="text-xs text-gray-500">
          Converted: family and student records exist — schedule them from{' '}
          <a href="/admin/tutoring" className="text-hgl-blue underline">the tutoring page</a>.
        </p>
      ) : (
        /* PL-22: the one door for creating a family/student that didn't come
           through a class — the schedule wizard only lists existing students. */
        <div className="flex items-center gap-2">
          <ConfirmAction
            label="Create family + student"
            message={`Create records for ${lead.contact_name ?? lead.contact_email ?? 'this family'} / ${lead.student_name ?? 'the student'}? An existing family with the same parent email is reused, never duplicated.`}
            confirmLabel="Yes, create them"
            className="text-hgl-blue underline font-semibold"
            confirmClassName="text-hgl-blue font-semibold underline"
            disabled={busy}
            onConfirm={() =>
              run({ action: 'create_family', id: lead.id }, 'Family and student created — schedule them from the tutoring page.')
            }
          />
          <span className="text-xs text-gray-400">
            makes them pickable in the New Student Schedule wizard
          </span>
        </div>
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

  // PL-188: scheduling usually happens on the TUTORING page while this tab
  // sits open — coming back must show the advanced stage without manual
  // refreshes ("needed several refreshes to drop off the pipeline").
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load])

  // PL-97: the intake-complete alert deep-links ?lead={id} — expand and
  // highlight the exact lead record on arrival (PL-99 semantics: the focus
  // hook polls until the data-loaded DOM contains the card).
  const [focusLead, setFocusLead] = useState<string | null>(null)
  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get('lead')
    if (leadId) {
      setExpanded(leadId)
      setFocusLead(`lead-${leadId}`)
    }
  }, [])
  useDeepLinkFocus(focusLead)
  // A deep-linked lead in a hidden group (scheduled/lost) must still render.
  useEffect(() => {
    if (!focusLead || !loaded) return
    const lead = leads.find((l) => `lead-${l.id}` === focusLead)
    if (lead && (lead.status === 'scheduled' || lead.status === 'lost')) setShowClosed(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, focusLead])

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
            <h1 className="text-2xl font-bold text-hgl-slate">Prospective students</h1>
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
            {/* PL-182: ONE add form (quick add and full add merged) — always
                visible, only a name required, focused after add so follow-up
                details go straight onto the new row. */}
            <CollapsibleSection title="Add a prospective student" subtitle="Mid-call, a name is enough — everything else is optional" accent="border-hgl-blue" defaultOpen>
              <NewLeadForm
                onCreated={(id) => {
                  refresh()
                  if (id) {
                    setExpanded(id)
                    setFocusLead(`lead-${id}`)
                  }
                }}
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="Pipeline"
              subtitle={`${open.length} open prospective student${open.length === 1 ? '' : 's'}${
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
                Show started &amp; closed
              </label>
              {open.length === 0 && !showClosed && (
                <p className="text-sm text-gray-500 italic">No open prospective students — nice and quiet.</p>
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
                          <div key={lead.id} id={`lead-${lead.id}`} className="border border-gray-200 rounded-lg p-3 bg-white">
                            <button
                              type="button"
                              className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1"
                              onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                            >
                              <span className="font-semibold text-hgl-slate">
                                {lead.student_name || lead.contact_name || lead.contact_email || 'Unnamed prospective student'}
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
                              {/* PL-108: the reason travels with the row. */}
                              {lead.status === 'lost' && lead.lost_reason_kind && (
                                <span
                                  className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5"
                                  title={lead.lost_reason ?? undefined}
                                >
                                  {LOST_REASONS[lead.lost_reason_kind] ?? lead.lost_reason_kind}
                                </span>
                              )}
                              {/* PL-109: every status surfaces its next step
                                  as an action, right on the row. */}
                              <NextStepButton lead={lead} onChange={refresh} />
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
              subtitle="Promotions that can be attached to a prospective student — none active at launch"
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
