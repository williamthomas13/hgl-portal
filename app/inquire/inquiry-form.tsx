'use client'

import { useState } from 'react'

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

export default function InquiryForm({ src }: { src: string | null }) {
  const [f, setF] = useState({
    parentName: '',
    parentEmail: '',
    parentPhone: '',
    studentName: '',
    studentSchool: '',
    subject: '',
    connectPref: '',
    other: '',
    company: '', // honeypot — stays empty for humans
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, src }),
      })
      const json = await res.json()
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
        <strong>Got it — thank you!</strong> We&apos;ll be in touch soon, usually the same day.
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Your name" required>
          <input className={inputCls} required value={f.parentName} onChange={(e) => set('parentName')(e.target.value)} />
        </Field>
        <Field label="Email" required>
          <input className={inputCls} type="email" required value={f.parentEmail} onChange={(e) => set('parentEmail')(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} type="tel" value={f.parentPhone} onChange={(e) => set('parentPhone')(e.target.value)} />
        </Field>
        <Field label="How do you prefer to connect?">
          <select className={`${inputCls} bg-white`} value={f.connectPref} onChange={(e) => set('connectPref')(e.target.value)}>
            <option value="">Pick one…</option>
            <option value="call">Phone call</option>
            <option value="text">Text</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </Field>
        <Field label="Student's name">
          <input className={inputCls} value={f.studentName} onChange={(e) => set('studentName')(e.target.value)} />
        </Field>
        <Field label="Student's school">
          <input className={inputCls} value={f.studentSchool} onChange={(e) => set('studentSchool')(e.target.value)} />
        </Field>
      </div>
      <Field label="What would you like help with?">
        <input
          className={inputCls}
          placeholder="e.g. SAT prep, Algebra 2, college essays"
          value={f.subject}
          onChange={(e) => set('subject')(e.target.value)}
        />
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
