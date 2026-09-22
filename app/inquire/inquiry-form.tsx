'use client'

import { useState } from 'react'
import { INTEREST_OPTIONS, channelNeeds, normalizeConnectPref } from '../utils/embed-forms'

// PL-38 client form: a superset of the six Squarespace variants, kept short —
// cold inquiries answer in under a minute; the full intake comes later.

const inputCls = 'block w-full border border-gray-300 rounded-md p-2'

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}

export default function InquiryForm({
  src,
  interest = null,
  school = null,
}: {
  src: string | null
  /** PL-470/473: pre-selected "What would you like help with?" from the link/embed. */
  interest?: string | null
  /** PL-470/473: pre-filled student's school (a class page's school). */
  school?: string | null
}) {
  const [f, setF] = useState({
    // PL-482: names arrive SPLIT (PL-466: both surnames live in the last-name
    // field — no splitting logic anywhere downstream).
    parentFirst: '',
    parentLast: '',
    parentEmail: '',
    parentPhone: '',
    studentFirst: '',
    studentLast: '',
    studentSchool: school ?? '',
    subject: interest ?? '',
    connectPref: '',
    other: '',
    company: '', // honeypot — stays empty for humans
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }))

  // PL-488: every field required except "Anything else" — the honest error
  // names EVERY missing field (a browser's native check stops at the first).
  // PL-494: Email / Phone are required by the chosen channel (channelNeeds —
  // the same rule the API and the embed run); the * markers follow it live.
  const needs = channelNeeds(normalizeConnectPref(f.connectPref))
  const REQUIRED: [keyof typeof f, string][] = [
    ['parentFirst', 'First name'], ['parentLast', 'Last name'], ['connectPref', 'How you prefer to connect'],
    ...(needs.email ? [['parentEmail', 'Email'] as [keyof typeof f, string]] : []),
    ...(needs.phone ? [['parentPhone', 'Phone'] as [keyof typeof f, string]] : []),
    ['studentFirst', 'Student first name'], ['studentLast', 'Student last name'],
    ['studentSchool', "Student's school"], ['subject', 'What you would like help with'],
  ]
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const missing = REQUIRED.filter(([k]) => !String(f[k] ?? '').trim()).map(([, label]) => label)
    if (missing.length) {
      setError(`Please fill in: ${missing.join(', ')}.`)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, src, interestTag: interest }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong — please try again, or just email us.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
        {/* PL-482: JSX eats the inline-boundary space — {' '} keeps it. */}
        <strong>Got it — thank you!</strong>{' '}We&apos;ll be in touch soon, usually the same day.
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="inquiry-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="First name" required>
          <input className={inputCls} required autoComplete="given-name" value={f.parentFirst} onChange={(e) => set('parentFirst')(e.target.value)} />
        </Field>
        <Field label="Last name" required>
          <input className={inputCls} required autoComplete="family-name" value={f.parentLast} onChange={(e) => set('parentLast')(e.target.value)} />
        </Field>
        {/* PL-494: the channel question comes first — it decides which of Email / Phone is required. */}
        <div className="sm:col-span-2">
          <Field label="How do you prefer to connect?" required>
            <select className={`${inputCls} bg-white`} required value={f.connectPref} onChange={(e) => set('connectPref')(e.target.value)} data-testid="inquiry-connect-pref">
              <option value="">Pick one…</option>
              <option value="call">Phone call</option>
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </Field>
        </div>
        <Field label="Email" required={needs.email}>
          <input className={inputCls} type="email" required={needs.email} value={f.parentEmail} onChange={(e) => set('parentEmail')(e.target.value)} data-testid="inquiry-email" />
        </Field>
        <Field label="Phone" required={needs.phone}>
          <input className={inputCls} type="tel" required={needs.phone} value={f.parentPhone} onChange={(e) => set('parentPhone')(e.target.value)} data-testid="inquiry-phone" />
        </Field>
        <Field label="Student first name" required>
          <input className={inputCls} required value={f.studentFirst} onChange={(e) => set('studentFirst')(e.target.value)} />
        </Field>
        <Field label="Student last name" required>
          <input className={inputCls} required value={f.studentLast} onChange={(e) => set('studentLast')(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          {/* PL-494: no helper placeholder (it was unreadable in the field). */}
          <Field label="Student's school" required>
            <input className={inputCls} required value={f.studentSchool} onChange={(e) => set('studentSchool')(e.target.value)} />
          </Field>
        </div>
      </div>
      <Field label="What would you like help with?" required>
        {/* PL-488: the same pick-one list the embed uses (+ free text via "Other"). */}
        <select className={`${inputCls} bg-white`} required value={f.subject} onChange={(e) => set('subject')(e.target.value)}>
          <option value="">Pick one…</option>
          {INTEREST_OPTIONS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </Field>
      <Field label="Anything else we should know?">
        <textarea
          className={inputCls}
          rows={3}
          placeholder="Grade, recent scores, goals, timing — whatever's useful"
          value={f.other}
          onChange={(e) => set('other')(e.target.value)}
        />
      </Field>
      {/* Honeypot — hidden from humans, tempting for bots */}
      <div className="hidden" aria-hidden="true">
        <label>
          Company
          <input tabIndex={-1} autoComplete="off" value={f.company} onChange={(e) => set('company')(e.target.value)} />
        </label>
      </div>

      {error && <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50"
      >
        {saving ? 'Sending…' : 'Get in touch'}
      </button>
      <p className="text-xs text-gray-400 text-center">
        Straight to our team — never shared, never a mailing list.
      </p>
    </form>
  )
}
