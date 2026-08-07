'use client'

import { useState } from 'react'
import { supabase } from '../utils/supabase'
import { OTP_LENGTH } from '../utils/otp'

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
  ssoError,
}: {
  prefillEmail: string
  next?: string
  linkError: boolean
  /** PL-272: the Google callback bounced — 'sso' (flow broke) or 'sso_denied' (not a staff account). */
  ssoError?: 'sso' | 'sso_denied'
}) {
  const [email, setEmail] = useState(prefillEmail)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  // PL-272: an SSO bounce reopens the staff panel so the retry is one click.
  const [staffMode, setStaffMode] = useState(Boolean(ssoError))
  const [error, setError] = useState(
    linkError
      ? `That sign-in link has expired or was already used — request a new one, or use the ${OTP_LENGTH}-digit code from the same email.`
      : ssoError === 'sso_denied'
        ? "That Google account isn't a Higher Ground staff account. Staff sign in with their @highergroundlearning.com Google account; families and school contacts use the email link above."
        : ssoError === 'sso'
          ? "Google sign-in didn't complete — try again, or use the email link above."
          : ''
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

  // PL-272: Google Workspace SSO — the primary staff path. The real gate is
  // server-side in /auth/callback (Workspace domain + staff/instructor
  // record); this just starts the OAuth dance. `hd` pre-filters the account
  // picker to Workspace accounts (a hint, not security).
  async function googleSignIn() {
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`,
        queryParams: { hd: 'highergroundlearning.com', prompt: 'select_account' },
        // Probe before leaving: with the provider not yet enabled, Supabase's
        // authorize endpoint serves a raw 400 JSON page — stranding the user
        // there is worse than an inline message.
        skipBrowserRedirect: true,
      },
    })
    if (error || !data?.url) {
      setError(
        "Google sign-in isn't available right now — use the email sign-in link instead (it works for staff accounts too)."
      )
      setLoading(false)
      return
    }
    try {
      const probe = await fetch(data.url, { redirect: 'manual' })
      // Provider enabled → the endpoint 302s toward Google (opaqueredirect).
      // Provider disabled → a CORS-readable 400.
      if (probe.type === 'opaqueredirect' || (probe.status >= 300 && probe.status < 400)) {
        window.location.assign(data.url)
        return
      }
      setError(
        "Google sign-in isn't responding right now — use the email sign-in link instead (it works for staff accounts too)."
      )
      setLoading(false)
    } catch {
      // Probe blocked (unexpected CORS change) — proceed; the callback's own
      // error path lands back here with a message either way.
      window.location.assign(data.url)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-10">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        <h1 className="text-2xl font-bold text-hgl-slate mb-1">Sign in</h1>
        <p className="text-sm text-gray-500 mb-6">Higher Ground Learning portal</p>

        {staffMode ? (
          <div className="space-y-4">
            {/* PL-272: Google Workspace is the staff front door — one click,
                no password, and Workspace offboarding closes it.
                PL-278: the password form is GONE — there was never a way to
                set a password, SSO is live and verified, and a second
                credential path is standing attack surface with zero users.
                Break-glass for a Google outage: the same magic-link flow
                every other user has (staff accounts receive them fine). */}
            <button type="button" onClick={googleSignIn} disabled={loading} className={buttonClass}>
              {loading ? 'Opening Google…' : 'Sign in with Google'}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Use your @highergroundlearning.com Google account.
            </p>
            <p className="text-xs text-gray-500 text-center">
              Trouble with Google?{' '}
              <button
                type="button"
                onClick={() => { setStaffMode(false); setError('') }}
                className="text-hgl-blue underline"
              >
                Get an email sign-in link instead
              </button>
              {' '}— it works for staff accounts too.
            </p>
          </div>
        ) : sent ? (
          <>
            <div className="mb-6 p-3 rounded-md text-sm bg-blue-50 text-hgl-slate space-y-2">
              <p>
                If this email is associated with Higher Ground Learning, a login link and code
                are on their way — check your inbox and spam folder.
              </p>
              {/* PL-256: not everyone signing in registered for a class —
                  tutoring-only families and staff sign in here too. */}
              <p className="text-gray-600">
                Not receiving anything? Make sure you&apos;re using the email address we have on
                file for you — the one on your class registration, your tutoring setup, or your
                staff account. Families sometimes sign up with an alternate or work email, and
                the login email must match the one we have. Still stuck? Reply to any of our
                emails or write{' '}
                <a href="mailto:info@highergroundlearning.com" className="text-hgl-blue underline">
                  info@highergroundlearning.com
                </a>{' '}
                and we&apos;ll sort it out.
              </p>
            </div>
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600">{OTP_LENGTH}-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern={`[0-9]{${OTP_LENGTH}}`}
                  maxLength={OTP_LENGTH}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoComplete="one-time-code"
                  className={`${inputClass} text-center text-2xl tracking-[0.4em] font-bold`}
                />
              </div>
              <button type="submit" disabled={loading || code.trim().length < OTP_LENGTH} className={buttonClass}>
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
            className={
              staffMode
                ? 'mt-6 w-full text-sm text-hgl-blue font-semibold hover:underline'
                : 'mt-6 w-full text-xs text-gray-400 hover:text-hgl-blue transition'
            }
          >
            {staffMode ? '← Back — sign in with an email link instead' : 'Staff sign-in with Google'}
          </button>
        )}
      </div>
    </div>
  )
}
