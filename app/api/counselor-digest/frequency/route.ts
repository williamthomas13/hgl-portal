import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { verifyDigestToken } from '../../../utils/lifecycle'

// One-click digest frequency switch from the counselor digest footer
// (PHASE4_SPEC §4a) — tokenized, no login. Returns a tiny HTML confirmation.

const LABELS: Record<string, string> = {
  weekly: 'weekly',
  biweekly: 'every 2 weeks',
  monthly: 'monthly',
  paused: 'paused',
}

function page(title: string, body: string, ok = true) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title></head>
     <body style="font-family:Helvetica,Arial,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
     <div style="background:#fff;border-top:4px solid ${ok ? '#00AEEE' : '#dc2626'};border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:32px;max-width:420px;text-align:center">
     <h1 style="color:#334155;font-size:20px;margin:0 0 8px">${title}</h1>
     <p style="color:#475569;font-size:14px;margin:0">${body}</p>
     </div></body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const counselorId = url.searchParams.get('c') ?? ''
  const frequency = url.searchParams.get('f') ?? ''
  const token = url.searchParams.get('t') ?? ''

  if (!counselorId || !token || !verifyDigestToken(counselorId, token)) {
    return page('Link not valid', 'This link is not valid — it may be incomplete. Try the link from your most recent digest email.', false)
  }
  if (!(frequency in LABELS)) {
    return page('Unknown option', 'That frequency option was not recognized.', false)
  }

  const { data, error } = await supabase
    .from('school_counselors')
    .update({ digest_frequency: frequency })
    .eq('id', counselorId)
    .select('first_name')
    .single()

  if (error || !data) {
    return page('Something went wrong', 'We could not update your preference — please reply to the digest email and we will set it for you.', false)
  }

  return page(
    frequency === 'paused' ? 'Digest paused' : 'Preference saved',
    frequency === 'paused'
      ? 'You will no longer receive the enrollment digest. Any link in an old digest can turn it back on.'
      : `Got it, ${data.first_name} — you'll now receive the enrollment digest ${LABELS[frequency]}.`
  )
}
