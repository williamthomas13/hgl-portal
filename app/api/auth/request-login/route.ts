import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../utils/supabase-admin'
import { deriveRoles, ensureAuthUser, safeNextPath } from '../../../utils/portal-auth'
import { loginLinkEmail, sendOnce } from '../../../utils/email'

// Passwordless login, step 1 (PHASE4_SPEC §2). Single email field on /login
// posts here. If the email matches any of the four sources (family parent,
// school counselor, class instructor, staff profile / ADMIN_EMAILS), we lazily
// create the auth user and send ONE email carrying both a magic link and a
// OTP code (length per the project Auth setting; utils/otp.ts) — generated via the Supabase admin API but delivered
// through Resend like every other portal email (verified domain, one
// template). No match sends nothing; the response is identical either way, so
// the endpoint can't be used to enumerate emails.

export async function POST(request: Request) {
  let body: { email?: string; next?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  // The generic response, sent regardless of whether we know this email.
  const generic = NextResponse.json({ ok: true })

  try {
    const roles = await deriveRoles(email)
    if (roles.length === 0) return generic

    await ensureAuthUser(email, roles)

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    if (error || !data?.properties) {
      console.error('generateLink failed:', error?.message)
      return generic
    }

    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const next = safeNextPath(body.next) ?? '/portal'
    const confirmUrl = `${base}/auth/confirm?token_hash=${encodeURIComponent(
      data.properties.hashed_token
    )}&next=${encodeURIComponent(next)}`

    // Minute-bucket dedupe = at most one login email per address per minute
    // (and a send record in email_log like everything else).
    const { subject, html } = loginLinkEmail(confirmUrl, data.properties.email_otp)
    await sendOnce({
      dedupeKey: `login_link:${email}:${Math.floor(Date.now() / 60_000)}`,
      emailType: 'login_link',
      to: [email],
      subject,
      html,
    })
  } catch (err) {
    console.error('request-login failed:', err instanceof Error ? err.message : err)
  }
  return generic
}
