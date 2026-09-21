'use client'

import { useState } from 'react'

// PL-54b: "tell me when the next one opens" capture for the closed / full /
// cancelled registration states. PL-484: a NAME travels with it (first name
// required, last name + student first name optional — so the first message
// HGL ever sends can be personal), and the College Prep Compass opt-in is
// one UNCHECKED checkbox that subscribes through PL-477's path. One compact
// row group; every input is full width so it stays one-handed at 375px.

export const COMPASS_OPT_IN_LABEL = 'Also send me the College Prep Compass — free test-prep and college-admissions tips by email.'

export default function InterestCapture({
  classId,
  schoolNickname,
  classType,
  evergreen = null,
  buttonLabel = 'Tell me first',
  compact = false,
}: {
  classId?: string
  schoolNickname: string
  classType: string
  /** PL-378: the between-classes capture has no class row — the school + type arrive directly. */
  evergreen?: { schoolId: string | null } | null
  buttonLabel?: string
  compact?: boolean
}) {
  const [email, setEmail] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [studentFirst, setStudentFirst] = useState('')
  const [compass, setCompass] = useState(false)
  const [company, setCompany] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/class-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(evergreen ? { evergreen: true, schoolId: evergreen.schoolId, classType } : { classId }),
          email,
          firstName: first,
          lastName: last,
          studentFirst,
          compassOptIn: compass,
          company,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-4 p-3 rounded bg-green-50 border border-green-200 text-green-800 text-sm text-left" data-testid="interest-done">
        <strong>You&apos;re on the list</strong> — we&apos;ll email you when the next{' '}
        {schoolNickname} {classType} course opens.
        {compass ? ' The College Prep Compass is on its way too.' : ''}
      </div>
    )
  }

  const input = 'w-full border border-gray-300 rounded-md p-2.5 text-sm'
  return (
    <form onSubmit={submit} className="mt-4 text-left" data-testid="interest-capture">
      {!compact && (
        <p className="text-sm font-semibold text-hgl-slate mb-2">
          Want to hear when the next {schoolNickname} {classType} course opens?
        </p>
      )}
      <div className="space-y-2">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email *" required autoComplete="email" className={input} />
        <div className="grid grid-cols-2 gap-2">
          <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Your first name *" required autoComplete="given-name" className={input} />
          <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" autoComplete="family-name" className={input} />
        </div>
        <input value={studentFirst} onChange={(e) => setStudentFirst(e.target.value)} placeholder="Student's first name (optional)" className={input} />
        {/* honeypot — humans never see it */}
        <input value={company} onChange={(e) => setCompany(e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <label className="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={compass} onChange={(e) => setCompass(e.target.checked)} className="mt-0.5" data-testid="compass-opt-in" />
          <span>{COMPASS_OPT_IN_LABEL}</span>
        </label>
        <button
          type="submit"
          disabled={busy || !email.trim() || !first.trim()}
          className="public-cta w-full bg-hgl-blue text-white font-bold py-2.5 rounded-md hover:opacity-90 transition disabled:opacity-50"
        >
          {busy ? 'Adding you…' : buttonLabel}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  )
}
