import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from "../../utils/supabase-admin"
import { verifyUnsubToken } from '../../utils/lifecycle'
import { verifyUnsubscribeToken, suppressEmail } from '../../utils/campaigns'

// One-click opt-out link in the footer of relationship emails (thank-you,
// 2nd diagnostic, review request, tutoring offer). Suppresses only those —
// transactional emails (class details, reminders, payment, waitlist) always
// send. Token is an HMAC of the family id, so links can't be forged or
// swapped between families.
//
// PL-201 extends this same endpoint (links in old footers keep working):
// · GET  ?token= (the new email-HMAC token) → the visible /unsubscribe page
// · POST ?token= → RFC 8058 one-click (mail clients POST with no user
//   context; the signed token IS the authorization)
// Legacy GET ?f=&t= now ALSO writes the family's email into the PL-201
// suppression list so both opt-out stores tell one story.

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
    <body style="font-family:Helvetica,Arial,sans-serif;background:#f9fafb;padding:40px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-top:4px solid #00AEEE;
        border-radius:8px;padding:32px;text-align:center;color:#1e293b">
        <h1 style="font-size:20px;color:#334155">${title}</h1>
        <p style="color:#475569">${body}</p>
      </div>
    </body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  // PL-201: the new email-HMAC token → the visible confirm page.
  const emailToken = url.searchParams.get('token')
  if (emailToken) return NextResponse.redirect(new URL(`/unsubscribe/${emailToken}`, request.url))

  const familyId = url.searchParams.get('f')
  const token = url.searchParams.get('t')

  if (!familyId || !token || !verifyUnsubToken(familyId, token)) {
    return page('Invalid link', 'This unsubscribe link is not valid.', 400)
  }

  const { error } = await supabase
    .from('families')
    .update({ marketing_opt_out: true })
    .eq('id', familyId)

  if (error) {
    console.error('Unsubscribe failed:', error.message)
    return page('Something went wrong', 'Please try again, or just reply to any of our emails.', 500)
  }

  // PL-201: mirror into the suppression list (one story, two stores).
  const { data: fam } = await supabase.from('families').select('parent_email').eq('id', familyId).maybeSingle()
  if (fam?.parent_email) await suppressEmail(fam.parent_email, 'legacy footer link')

  return page(
    "You're unsubscribed",
    'You will no longer receive non-essential updates. Class logistics — schedules, ' +
      'locations, and payment notices — will still reach you.'
  )
}

// PL-201: RFC 8058 one-click target — the List-Unsubscribe header points here.
export async function POST(request: Request) {
  const emailToken = new URL(request.url).searchParams.get('token') ?? ''
  const email = verifyUnsubscribeToken(emailToken)
  if (!email) return NextResponse.json({ error: 'Invalid link.' }, { status: 400 })
  await suppressEmail(email, 'one-click header')
  return NextResponse.json({ ok: true })
}
