'use client'

import { useState } from 'react'
import { supabase } from '../utils/supabase'

// Client half of /login. Step 1 posts the email to /api/auth/request-login
// (which answers identically whether or not the email is known — no
// enumeration); step 2 shows the OTP entry, since the same email carries both
// the link and the code.

const inputClass =
  'mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition'
const buttonClass =
  'w-full bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-60'

export default function LoginForm({
  prefillEmail,
  next,
  linkError,
}: {
  prefillEmail: string
  next?: string
  linkError: boolean
}) {
  const [email, setEmail] = useState(prefillEmail)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [staffMode, setStaffMode] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(
    linkError ? 'That sign-in link has expired or was already used — request a new one, or use the 6-digit code from the same email.' : ''
  )
  const [loading, setLoading] = useState(false)

  async function requestLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const normalized = email.trim().toLowerCase()
    // Catch obvious mangling (missing @, spaces) inline; TLD typos like
    // ".con" just fail the lookup naturally and get the generic message.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("That doesn't look like a valid email address — double-check it and try again.")
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized, next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Something went wrong — please try again.')
      } else {
        setSent(true)
      }
    } catch {
      setError('Something went wrong — please try again.')
    }
    setLoading(false)
  }

  async function verifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    })
    if (error) {
      setError("That code didn't work — it may have expired. You can request a new one.")
      setLoading(false)
      return
    }
    // Full navigation so the proxy and server layouts see the new session.
    window.location.assign(next ?? '/portal')
  }

  async function staffSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      setError(
        error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message
      )
      setLoading(false)
      return
    }
    window.location.assign(next ?? '/admin')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-10">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        <h1 className="text-2xl font-bold text-hgl-slate mb-1">Sign in</h1>
        <p className="text-sm text-gray-500 mb-6">Higher Ground Learning portal</p>

        {staffMode ? (
          <form onSubmit={staffSignIn} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm text-gray-600">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className={inputClass} />
            </div>
            <button type="submit" disabled={loading} className={buttonClass}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : sent ? (
          <>
            <div className="mb-6 p-3 rounded-md text-sm bg-blue-50 text-hgl-slate space-y-2">
              <p>
                If this email is associated with Higher Ground Learning, a login link and code
                are on their way — check your inbox and spam folder.
              </p>
              <p className="text-gray-600">
                Not receiving anything? Make sure you&apos;re using the exact email address you
                used when registering for a class. Parents sometimes register with an alternate
                or work email — the login email must match the one on the registration. Still
                stuck? Reply to any of our emails or write{' '}
                <a href="mailto:info@highergroundlearning.com" className="text-hgl-blue underline">
                  info@highergroundlearning.com
                </a>{' '}
                and we&apos;ll sort it out.
              </p>
            </div>
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600">6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoComplete="one-time-code"
                  className={`${inputClass} text-center text-2xl tracking-[0.5em] font-bold`}
                />
              </div>
              <button type="submit" disabled={loading || code.trim().length < 6} className={buttonClass}>
                {loading ? 'Checking...' : 'Sign in with code'}
              </button>
            </form>
            <button
              onClick={() => { setSent(false); setCode(''); setError('') }}
              className="mt-4 w-full text-sm text-gray-500 hover:text-hgl-blue transition"
            >
              Use a different email or resend the link
            </button>
          </>
        ) : (
          <form onSubmit={requestLink} className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter your email and we&apos;ll send you a sign-in link — no password needed.
            </p>
            <div>
              <label className="block text-sm text-gray-600">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className={inputClass} />
            </div>
            <button type="submit" disabled={loading} className={buttonClass}>
              {loading ? 'Sending...' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-md text-center text-sm font-bold bg-red-100 text-red-700">
            {error}
          </div>
        )}

        {!sent && (
          <button
            onClick={() => { setStaffMode(!staffMode); setError('') }}
            className="mt-6 w-full text-xs text-gray-400 hover:text-hgl-blue transition"
          >
            {staffMode ? 'Sign in with an email link instead' : 'Staff sign-in with password'}
          </button>
        )}
      </div>
    </div>
  )
}
