import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { companyName, exchangeAuthCode, verifyOauthState } from '../../../utils/qbo'
import { sessionRole } from '../../../utils/staff-gate'

// Intuit redirects here after the admin approves access (Phase 6 §6).
// The state param is our signed timestamp (CSRF guard); realmId identifies
// the QBO company. Lands back on /admin with a ?qbo= status the panel shows.
export async function GET(req: Request) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const bounce = (status: string) => NextResponse.redirect(`${base}/admin?qbo=${status}`)

  const caller = await sessionRole('admin')
  if (!caller) return bounce('denied')

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const realmId = url.searchParams.get('realmId')
  if (url.searchParams.get('error')) return bounce('cancelled')
  if (!code || !realmId || !state || !verifyOauthState(state)) return bounce('invalid')

  try {
    await exchangeAuthCode(code, realmId, caller.email)
    // Snapshot the company name for the connection card.
    const name = await companyName()
    if (name) {
      await supabase
        .from('qbo_connection')
        .update({ realm_name: name })
        .eq('id', 1)
    }
    return bounce('connected')
  } catch (e) {
    console.error('QBO OAuth exchange failed:', e)
    return bounce('error')
  }
}
