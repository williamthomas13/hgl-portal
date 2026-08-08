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

// PL-301: closing collects the reason INLINE — a dropdown of the five clean
// enum values plus an optional note (required for "other"), replacing the
// old native prompt() whose free text guaranteed dirty data ("too expensive"
// ≠ 'price') and froze the automation bridge.
function CloseLeadPanel({
  busy,
  onClose,
  onCancel,
}: {
  busy: boolean
  onClose: (reason: { kind: string; text: string | null }) => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState('price')
  const [text, setText] = useState('')
  const noteMissing = kind === 'other' && !text.trim()
  return (
    <div className="w-full bg-amber-50 border border-amber-200 rounded-md p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-900">
        Close this lead — why didn&apos;t it work out (for now)?
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-amber-900 mb-1">Reason</label>
          <select
            className={`${inputCls} bg-white w-auto`}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {Object.entries(LOST_REASONS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs text-amber-900 mb-1">
            {kind === 'other' ? 'A few words on why (required)' : 'Anything worth noting? (optional)'}
          </label>
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <button
          type="button"
          disabled={busy || noteMissing}
          onClick={() => onClose({ kind, text: text.trim() || null })}
          className="bg-hgl-slate text-white font-bold py-1.5 px-4 rounded-md hover:opacity-90 disabled:opacity-50 text-sm"
        >
          Close the lead
        </button>
        <button type="button" onClick={onCancel} className="text-gray-500 underline text-sm">
          never mind
        </button>
      </div>
    </div>
  )
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

async function post(body: Record<string, unknown>): Promise<{
  ok: boolean
  error?: string
  gcal?: string
  supersededConsult?: { at: string; owner: string | null; onCalendar: boolean } | null
}> {
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

// ---------------------------------------------------------------------------
// PL-194: duplicate radar for the add form. Scarlett added the same test
// student three times (once with a typo, once identical) because nothing
// suggested existing records while typing. Matches run against BOTH pipeline
// leads and real student records — a lead duplicating an enrolled student is
// the same disease — with typo tolerance, and an exact-name save requires
// walking past a plain warning (two different Ana Garcías stay creatable).
// ---------------------------------------------------------------------------

/** Small edit-distance for typo matching ("Jaon" still finds "Jason"). */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
  return dp[a.length][b.length]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Does the typed name look like this existing name? Substring both ways,
 *  or within 2 edits once at least 4 characters are down. */
function nameLooksLike(typed: string, existing: string | null | undefined): boolean {
  if (!existing) return false
  const t = norm(typed)
  const e = norm(existing)
  if (t.length < 3) return false
  if (e.includes(t) || t.includes(e)) return true
  return t.length >= 4 && editDistance(t, e) <= 2
}

type DupMatch = {
  kind: 'lead' | 'student'
  id: string
  name: string
  context: string
  exact: boolean
}

function NewLeadForm({
  onCreated,
  onOpenExisting,
}: {
  onCreated: (id: string) => void
  onOpenExisting: (leadId: string) => void
}) {
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
  const set = (k: keyof typeof blank) => (v: string) => {
    setF((p) => ({ ...p, [k]: v }))
    setDupArmed(false) // typing again invalidates a stale "add anyway" arming
  }
  // The bare minimum: enough to identify them — a name (parent or student)
  // or an email. Same rule the server enforces.
  const identified = !!(f.contact_name.trim() || f.contact_email.trim() || f.student_name.trim())

  // PL-194: the duplicate radar. One light fetch of names when typing starts;
  // matching (with typo tolerance) runs locally as you type.
  const [pool, setPool] = useState<{ leads: any[]; students: any[] } | null>(null)
  const [matches, setMatches] = useState<DupMatch[]>([])
  useEffect(() => {
    const typedStudent = f.student_name.trim()
    const typedContact = f.contact_name.trim()
    if (typedStudent.length < 3 && typedContact.length < 3) {
      setMatches([])
      return
    }
    let cancelled = false
    ;(async () => {
      let p = pool
      if (!p) {
        const [leadsRes, studentsRes] = await Promise.all([
          supabase
            .from('leads')
            .select('id, student_name, contact_name, contact_email, status, student_school'),
          supabase
            .from('students')
            .select('id, first_name, last_name, school, grade_level, families ( parent_first_name, parent_last_name )'),
        ])
        p = { leads: (leadsRes.data as any[]) ?? [], students: (studentsRes.data as any[]) ?? [] }
        if (cancelled) return
        setPool(p)
      }
      const out: DupMatch[] = []
      for (const l of p.leads) {
        const byStudent = typedStudent.length >= 3 && nameLooksLike(typedStudent, l.student_name)
        const byContact = typedContact.length >= 3 && nameLooksLike(typedContact, l.contact_name)
        if (byStudent || byContact) {
          out.push({
            kind: 'lead',
            id: l.id,
            name: l.student_name || l.contact_name || l.contact_email || 'Unnamed',
            context: [
              l.student_name && l.contact_name ? `parent ${l.contact_name}` : null,
              l.student_school,
              `already in the pipeline — ${LEAD_STATUS_LABELS[l.status] ?? l.status}`,
            ]
              .filter(Boolean)
              .join(' · '),
            exact:
              (!!l.student_name && norm(l.student_name) === norm(typedStudent)) ||
              (!!l.contact_name && !!typedContact && norm(l.contact_name) === norm(typedContact)),
          })
        }
      }
      for (const s of p.students) {
        const full = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim()
        if (typedStudent.length >= 3 && nameLooksLike(typedStudent, full)) {
          const fam = Array.isArray(s.families) ? s.families[0] : s.families
          out.push({
            kind: 'student',
            id: s.id,
            name: full,
            context: [
              fam ? `parent ${`${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim()}` : null,
              s.school,
              s.grade_level ? `Grade ${s.grade_level}` : null,
              'already a student here',
            ]
              .filter(Boolean)
              .join(' · '),
            exact: norm(full) === norm(typedStudent),
          })
        }
      }
      if (!cancelled) setMatches(out.slice(0, 6))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.student_name, f.contact_name])

  // PL-194 + PL-301 rule: an EXACT name match never saves silently — the
  // first Add arms an inline warning (no native confirm) and a second,
  // explicit click creates anyway (two different Ana Garcías stay creatable).
  const [dupArmed, setDupArmed] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const exact = matches.filter((m) => m.exact)
    if (exact.length > 0 && !dupArmed) {
      setDupArmed(true)
      return
    }
    setDupArmed(false)
    setSaving(true)
    setError(null)
    const res = await post({ action: 'create', ...f })
    setSaving(false)
    if (!res.ok) return setError(res.error ?? 'Failed.')
    setF(blank)
    setMatches([])
    setPool(null) // the new record must itself be suggestable right away
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
      {/* PL-194: the duplicate radar — matching leads AND students surface
          while typing, with enough context to recognize them. Selecting one
          opens the existing record instead of creating. */}
      {matches.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-md p-3 text-sm">
          <p className="text-xs font-bold text-amber-900 mb-1.5">
            Might already be here — open theirs instead of adding twice:
          </p>
          <ul className="space-y-1">
            {matches.map((m) => (
              <li key={`${m.kind}-${m.id}`} className="text-xs text-amber-900">
                {m.kind === 'student' ? (
                  <a href={`/admin/students/${m.id}`} className="font-semibold underline text-hgl-blue">
                    {m.name}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenExisting(m.id)}
                    className="font-semibold underline text-hgl-blue"
                  >
                    {m.name}
                  </button>
                )}{' '}
                — {m.context}
                {m.exact && <span className="ml-1 font-bold">(exact name)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

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
      {dupArmed && (
        <div className="bg-amber-50 border border-amber-300 rounded-md p-3 text-sm text-amber-900">
          <p className="font-semibold">
            This exact name already exists (listed above). Add a NEW record with the same name
            anyway? Fine if they&apos;re genuinely different people.
          </p>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !identified}
          className={`${dupArmed ? 'bg-amber-600' : 'bg-hgl-slate'} text-white font-bold py-2 px-5 rounded-md hover:opacity-90 disabled:opacity-50 text-sm`}
        >
          {saving ? 'Adding…' : dupArmed ? 'Add anyway — different person' : 'Add to pipeline'}
        </button>
        {dupArmed && (
          <button type="button" className="text-sm text-gray-500 underline" onClick={() => setDupArmed(false)}>
            never mind
          </button>
        )}
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
  const [err, setErr] = useState<string | null>(null)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const act = async (e: React.MouseEvent, body: Record<string, unknown>, okMsg: string) => {
    e.stopPropagation()
    setBusy(true)
    setErr(null)
    const res = await post(body)
    setBusy(false)
    if (!res.ok) setErr(res.error ?? 'Failed.')
    else onChange()
    void okMsg
  }
  const cls = 'text-xs font-semibold text-white bg-hgl-blue rounded px-2.5 py-1 hover:opacity-90 disabled:opacity-50'
  const studentFirst = (lead.student_name ?? '').split(' ')[0] || 'the student'
  const errSpan = err ? <span className="text-xs text-red-600 ml-2" onClick={stop}>{err}</span> : null

  if (lead.status === 'new' || lead.status === 'contacted' || lead.status === 'intake_sent') {
    if (!lead.contact_email) return <span className="text-xs text-gray-400" onClick={stop}>next: get a contact email</span>
    const resend = lead.status === 'intake_sent'
    return (
      <span onClick={stop} className="inline-flex items-center">
        <ConfirmAction
          label={resend ? 'Re-send intake form' : 'Send intake form'}
          message={`Email the intake form link to ${lead.contact_email}?`}
          confirmLabel="Yes, send it"
          className={cls}
          confirmClassName="text-hgl-blue font-semibold underline text-xs"
          disabled={busy}
          onConfirm={() =>
            act({ stopPropagation: () => {} } as React.MouseEvent, { action: 'send_intake', id: lead.id }, 'sent')
          }
        />
        {errSpan}
      </span>
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
      <span onClick={stop} className="inline-flex items-center">
        <button type="button" disabled={busy} className={cls}
          onClick={(e) => act(e, { action: 'update', id: lead.id, status: 'consult_done' }, 'done')}>
          Mark consult done
        </button>
        {errSpan}
      </span>
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

// ---------------------------------------------------------------------------
// PL-313: "this looks like the same person" — pending close matches for a
// lead, both records side by side, link-or-not (never auto-merged; "not the
// same" is remembered and never re-asks).
type MatchInfo = {
  id: string
  reasons: string[]
  student: { id: string; name: string; grade: string | null } | null
  family: { id: string; parentName: string; parentEmail: string } | null
  enrollment: { id: string; status: string; classLabel: string | null } | null
}

function CloseMatchPrompt({ lead, onChange }: { lead: Lead; onChange: () => void }) {
  const [matches, setMatches] = useState<MatchInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/record-match?lead=${lead.id}`)
      .then((r) => (r.ok ? r.json() : { matches: [] }))
      .then((j) => {
        if (!cancelled) setMatches(j.matches ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [lead.id])
  if (matches.length === 0) return null

  const decide = async (id: string, action: 'link' | 'not_same') => {
    setBusy(true)
    setErr(null)
    const res = await fetch('/api/admin/record-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErr(j.error ?? 'Failed.')
      return
    }
    setMatches((m) => m.filter((x) => x.id !== id))
    onChange()
  }

  return (
    <div className="space-y-3">
      {matches.map((m) => (
        <div key={m.id} className="bg-purple-50 border border-purple-300 rounded-md p-3 text-sm">
          <p className="font-bold text-purple-900 mb-2">
            This looks like the same person — link them?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
            <div className="bg-white rounded border border-purple-200 p-2 text-xs">
              <p className="font-semibold text-gray-500 uppercase mb-1">Pipeline lead</p>
              <p><span className="text-gray-400">Student:</span> {lead.student_name ?? '—'}</p>
              <p><span className="text-gray-400">Contact:</span> {lead.contact_name ?? '—'}</p>
              <p><span className="text-gray-400">Email:</span> {lead.contact_email ?? '—'}</p>
              <p><span className="text-gray-400">Phone:</span> {lead.contact_phone ?? '—'}</p>
              <p><span className="text-gray-400">Stage:</span> {LEAD_STATUS_LABELS[lead.status] ?? lead.status}</p>
            </div>
            <div className="bg-white rounded border border-purple-200 p-2 text-xs">
              <p className="font-semibold text-gray-500 uppercase mb-1">Registered record</p>
              <p><span className="text-gray-400">Student:</span> {m.student?.name ?? '—'}{m.student?.grade ? ` · Grade ${m.student.grade}` : ''}</p>
              <p><span className="text-gray-400">Parent:</span> {m.family?.parentName ?? '—'}</p>
              <p><span className="text-gray-400">Email:</span> {m.family?.parentEmail ?? '—'}</p>
              {m.enrollment && (
                <p>
                  <span className="text-gray-400">Enrollment:</span> {m.enrollment.classLabel ?? 'a class'} ·{' '}
                  {m.enrollment.status}
                </p>
              )}
              {m.student && (
                <a href={`/admin/students/${m.student.id}`} className="text-hgl-blue underline">
                  student profile →
                </a>
              )}
            </div>
          </div>
          <p className="text-xs text-purple-800 mb-2">Why it matched: {m.reasons.join(' · ')}</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(m.id, 'link')}
              className="bg-purple-700 text-white font-bold py-1.5 px-4 rounded-md hover:opacity-90 disabled:opacity-50 text-sm"
            >
              Link them — same person
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(m.id, 'not_same')}
              className="bg-white border border-purple-400 text-purple-900 font-bold py-1.5 px-4 rounded-md hover:bg-purple-100 disabled:opacity-50 text-sm"
            >
              Not the same — don&apos;t ask again
            </button>
            <span className="text-xs text-purple-700 self-center">
              Linking marks this lead Started and connects it to the record — nothing merges
              beyond that.
            </span>
          </div>
          {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
        </div>
      ))}
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
  // PL-300: every intake field is editable right on the card — phone-call
  // leads start email-less and must be able to gain one here (the intake
  // send and Create family + student then unblock on their own).
  const [fields, setFields] = useState({
    contact_name: lead.contact_name ?? '',
    contact_email: lead.contact_email ?? '',
    contact_phone: lead.contact_phone ?? '',
    student_name: lead.student_name ?? '',
    student_school: lead.student_school ?? '',
    student_grade: lead.student_grade ?? '',
    source: lead.source,
    interest: lead.interest,
    subjects: lead.subjects ?? '',
  })
  const setField = (k: keyof typeof fields) => (v: string) => setFields((p) => ({ ...p, [k]: v }))
  // PL-301: the inline close panel (one panel, both doors — the "Close
  // lead…" link and picking Closed in the status dropdown).
  const [closeOpen, setCloseOpen] = useState(false)
  // PL-302: consult length, 30 minutes by default.
  const [consultDuration, setConsultDuration] = useState(30)
  // PL-303: a scheduled-but-not-yet-happened consult that a phone consult
  // just superseded — keep-or-cancel until answered.
  const [superseded, setSuperseded] = useState<{ at: string; owner: string | null; onCalendar: boolean } | null>(null)
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
    if (!res.ok) {
      setErr(res.error ?? 'Failed.')
      return res
    }
    setMsg(res.gcal === 'failed' ? `${okMsg} (Google Calendar push failed — event not created)` : okMsg)
    onChange()
    return res
  }

  const activeOffers = offers.filter((o) => o.active || o.id === lead.offer_id)

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
      {/* PL-313: pending same-person prompts render first — they change
          what everything below should even be doing. */}
      <CloseMatchPrompt lead={lead} onChange={onChange} />
      {lead.status === 'lost' && lead.lost_reason_kind && (
        <p className="text-xs text-gray-500">
          Closed — not now: <span className="font-semibold">{LOST_REASONS[lead.lost_reason_kind] ?? lead.lost_reason_kind}</span>
          {lead.lost_reason ? ` — ${lead.lost_reason}` : ''}
        </p>
      )}
      {/* PL-300: the same fields as "Add a prospective student", editable in
          place — whatever wasn't known at add time lands here later. */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Parent / contact name</label>
          <input className={inputCls} value={fields.contact_name} onChange={(e) => setField('contact_name')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
          <input className={inputCls} type="tel" value={fields.contact_phone} onChange={(e) => setField('contact_phone')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
          <input className={inputCls} type="email" value={fields.contact_email} onChange={(e) => setField('contact_email')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Student name</label>
          <input className={inputCls} value={fields.student_name} onChange={(e) => setField('student_name')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Source</label>
          <select className={`${inputCls} bg-white`} value={fields.source} onChange={(e) => setField('source')(e.target.value)}>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">School</label>
          <input className={inputCls} value={fields.student_school} onChange={(e) => setField('student_school')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Grade</label>
          <input className={inputCls} value={fields.student_grade} onChange={(e) => setField('student_grade')(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Interest</label>
          <select className={`${inputCls} bg-white`} value={fields.interest} onChange={(e) => setField('interest')(e.target.value)}>
            {Object.entries(INTEREST_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Subject(s) / test</label>
        <input className={inputCls} placeholder="e.g. SAT / Algebra 2" value={fields.subjects} onChange={(e) => setField('subjects')(e.target.value)} />
      </div>
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
            // PL-108/PL-301: picking "Closed — not now" in the dropdown also
            // requires the reason — the same inline panel opens.
            if (status === 'lost' && lead.status !== 'lost') {
              setCloseOpen(true)
              return
            }
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
                ...fields,
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
          <span className="text-xs text-gray-400">
            Add a contact email above (then Save) to send the intake form
          </span>
        )}
        {lead.status !== 'lost' && !closeOpen && (
          <button
            type="button"
            disabled={busy}
            className="text-gray-500 underline"
            onClick={() => setCloseOpen(true)}
          >
            Close lead…
          </button>
        )}
      </div>
      {closeOpen && (
        <CloseLeadPanel
          busy={busy}
          onCancel={() => {
            setCloseOpen(false)
            if (status === 'lost' && lead.status !== 'lost') setStatus(lead.status)
          }}
          onClose={(reason) => {
            setCloseOpen(false)
            setStatus('lost')
            run(
              {
                action: 'update',
                id: lead.id,
                status: 'lost',
                lost_reason_kind: reason.kind,
                lost_reason: reason.text,
                notes,
                offer_id: offerId || null,
                ...fields,
              },
              'Closed — not now (reason saved).'
            )
          }}
        />
      )}

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
                ? lead.consult_gcal_event_id
                  ? ' · by phone (an earlier scheduled meeting was kept on the calendar)'
                  : ' · by phone (already happened — no calendar event)'
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
            {/* PL-302: length picker, 30 minutes by default. */}
            <label className="block text-xs text-gray-500 mb-1">Length</label>
            <select
              className={`${inputCls} bg-white`}
              value={consultDuration}
              onChange={(e) => setConsultDuration(Number(e.target.value))}
            >
              {[15, 20, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
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
                  duration_minutes: consultDuration,
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
            onClick={async () => {
              const res = await run(
                {
                  action: 'record_phone_consult',
                  id: lead.id,
                  happened_at: new Date(phoneConsultDate + 'T12:00:00').toISOString(),
                  notes: phoneConsultNotes.trim() || undefined,
                },
                'Phone consult recorded — no calendar event, pipeline advanced.'
              )
              // PL-303: a not-yet-happened scheduled consult was superseded —
              // whatever remains on a calendar must be there on purpose.
              if (res.ok && res.supersededConsult) setSuperseded(res.supersededConsult)
            }}
            className="bg-white border border-gray-400 text-gray-700 font-bold py-1.5 px-4 rounded-md hover:bg-gray-100 disabled:opacity-50"
          >
            Record phone consult
          </button>
        </div>
        {superseded && (
          <div className="mt-3 bg-amber-50 border border-amber-300 rounded p-3 text-xs text-amber-900 space-y-2">
            <p className="font-semibold">
              A consultation was already scheduled for {fmtWhen(superseded.at)}
              {superseded.owner ? ` with ${superseded.owner}` : ''}
              {superseded.onCalendar ? ' and is on their Google Calendar' : ''}. Keep it, or cancel
              it?
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                className="bg-white border border-amber-400 text-amber-900 font-bold py-1 px-3 rounded hover:bg-amber-100"
                onClick={() => {
                  setSuperseded(null)
                  setMsg(
                    superseded.owner
                      ? `Kept — the meeting stays on ${superseded.owner}'s calendar on purpose (maybe they still come in).`
                      : 'Kept — the scheduled consultation stands.'
                  )
                }}
              >
                Keep it — they may still come in
              </button>
              <button
                type="button"
                disabled={busy}
                className="bg-white border border-amber-400 text-amber-900 font-bold py-1 px-3 rounded hover:bg-amber-100"
                onClick={async () => {
                  setBusy(true)
                  const res = await post({
                    action: 'cancel_scheduled_consult',
                    id: lead.id,
                    owner_email: superseded.owner ?? '',
                  })
                  setBusy(false)
                  setSuperseded(null)
                  if (!res.ok) return setErr(res.error ?? 'Failed.')
                  setMsg(
                    res.gcal === 'failed'
                      ? 'Consult cancelled here — but removing the Google Calendar event failed; delete it from the calendar by hand.'
                      : res.gcal === 'removed'
                        ? 'Scheduled consult cancelled and removed from the calendar.'
                        : 'Scheduled consult cancelled.'
                  )
                  onChange()
                }}
              >
                Cancel it — remove from the calendar
              </button>
            </div>
          </div>
        )}
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
        <div className="flex flex-wrap items-center gap-2">
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

function OffersPanel({
  offers,
  leads,
  onChange,
}: {
  offers: Offer[]
  leads: Lead[]
  onChange: () => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('free_hours')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // PL-304: delete only while nothing carries the offer — counted from the
  // pipeline (converted/closed leads included); the server re-checks.
  const usedCount = (offerId: string) => leads.filter((l) => l.offer_id === offerId).length

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
          No offers yet. Create one when a promotion runs; active offers can be attached to
          prospective students and materialize on their first invoice.
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
                <td className="py-2 text-right space-x-3">
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
                  {usedCount(o.id) === 0 ? (
                    <ConfirmAction
                      label="Delete"
                      message={`Delete "${o.name}" for good? Nothing carries it, so nothing changes for any family.`}
                      confirmLabel="Yes, delete it"
                      className="text-red-700 underline text-xs"
                      confirmClassName="text-red-700 font-semibold underline text-xs"
                      disabled={busy}
                      onConfirm={async () => {
                        setErr(null)
                        const res = await post({ action: 'delete_offer', id: o.id })
                        if (!res.ok) setErr(res.error ?? 'Delete failed.')
                        onChange()
                      }}
                    />
                  ) : (
                    <span
                      className="text-xs text-gray-400"
                      title="Detach it from those prospective students to make it deletable."
                    >
                      attached to {usedCount(o.id)} — can&apos;t delete
                    </span>
                  )}
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
  // PL-304: the Offers panel is admin-only — ask the API who's here.
  const [role, setRole] = useState<'admin' | 'manager' | null>(null)
  useEffect(() => {
    fetch('/api/admin/leads')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRole(j?.role ?? null))
      .catch(() => setRole(null))
  }, [])

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
                onOpenExisting={(id) => {
                  // PL-194: selecting a suggestion opens the existing lead —
                  // including one already started/closed, so show those rows.
                  setShowClosed(true)
                  setExpanded(id)
                  setFocusLead(`lead-${id}`)
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
                              {/* PL-193: once records exist, the student's
                                  profile is one click from the pipeline. */}
                              {lead.student_id && (
                                <a
                                  href={`/admin/students/${lead.student_id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs text-hgl-blue underline"
                                >
                                  student profile
                                </a>
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

            {role === 'admin' && (
              <CollapsibleSection
                title="Offers"
                subtitle="Promotions that can be attached to a prospective student"
              >
                <OffersPanel offers={offers} leads={leads} onChange={refresh} />
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
