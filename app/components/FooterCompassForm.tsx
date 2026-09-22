'use client'

import { useState } from 'react'
import { COMPASS_SPEC } from '../utils/embed-forms'

// PL-493: the footer newsletter block IS the College Prep Compass capture
// (PL-477) — same endpoint the /compass page posts to, same success copy,
// the honeypot every public form carries. Source-tagged 'portal:footer'.
export default function FooterCompassForm() {
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setState('busy')
    try {
      const res = await fetch(COMPASS_SPEC.apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, company, source: 'portal:footer' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error ?? 'That did not go through — please try again.')
        setState('error')
        return
      }
      setState('done')
    } catch {
      setError('That did not go through — please try again.')
      setState('error')
    }
  }
  if (state === 'done') {
    return (
      <p className="rounded-md bg-green-50 border border-green-200 text-green-800 px-4 py-3" data-testid="footer-compass-done">
        {COMPASS_SPEC.thankYou}
      </p>
    )
  }
  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3" data-testid="footer-compass" noValidate>
      <label className="sr-only" htmlFor="footer-compass-email">Email Address</label>
      <input
        id="footer-compass-email"
        type="email"
        required
        autoComplete="email"
        placeholder="Email Address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 min-w-0 border border-gray-300 rounded-[7px] px-4 py-3 text-[17px] text-black bg-white"
      />
      {/* Honeypot — hidden from humans, tempting for bots */}
      <div className="hidden" aria-hidden="true">
        <label>
          Company
          <input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
      </div>
      <button
        type="submit"
        disabled={state === 'busy'}
        className="bg-hgl-blue text-white text-[17px] px-6 py-3 rounded-[7px] hover:bg-hgl-blue-hover disabled:opacity-50 whitespace-nowrap"
      >
        {state === 'busy' ? 'Signing up…' : 'Sign Up'}
      </button>
      {error && <p className="sm:basis-full text-sm text-red-700" role="alert">{error}</p>}
    </form>
  )
}
