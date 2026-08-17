'use client'

import { useState } from 'react'

// PL-378 B/C: the between-classes interest capture behind an evergreen
// link — feeds the existing class_interest machinery (the roster's
// "families are waiting to hear" count + notify flow). No account, no
// payment; the same honeypot the class-interest API already checks.

export default function EvergreenCapture({
  schoolId,
  classType,
  heading,
  sub,
}: {
  schoolId: string | null
  classType: string
  heading: string
  sub: string
}) {
  const [email, setEmail] = useState('')
  const [studentName, setStudentName] = useState('')
  const [company, setCompany] = useState('') // honeypot
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit() {
    setState('busy')
    setError('')
    try {
      const res = await fetch('/api/class-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evergreen: true, schoolId, classType, email, studentName, company }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'That did not go through — try again?')
        setState('error')
        return
      }
      setState('done')
    } catch {
      setError('That did not go through — try again?')
      setState('error')
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8 my-12">
      <h1 className="text-2xl font-bold text-hgl-slate mb-2">{heading}</h1>
      <p className="text-gray-600 mb-5">{sub}</p>
      {state === 'done' ? (
        <p className="bg-green-50 border border-green-200 text-green-800 rounded p-3 text-sm font-semibold">
          You&apos;re on the list — we&apos;ll email you the moment the next class opens.
        </p>
      ) : (
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your email *"
            className="w-full border border-gray-300 rounded-md p-2.5"
          />
          <input
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="Student's name (optional)"
            className="w-full border border-gray-300 rounded-md p-2.5"
          />
          {/* honeypot — humans never see it */}
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden
          />
          <button
            onClick={submit}
            disabled={state === 'busy' || !email.trim()}
            className="w-full bg-hgl-blue text-white font-bold py-3 rounded-md hover:opacity-90 transition disabled:opacity-50"
          >
            {state === 'busy' ? 'Adding you…' : 'Email me when it opens'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
