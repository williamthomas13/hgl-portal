import { NextResponse } from 'next/server'
import { saveGcalConnection, loadGcalConnection, freeBusy } from '../../../utils/gcal'
import { sessionRole } from '../../../utils/staff-gate'

// Store the service-account JSON key (Phase 7a §4). Admin-only — calendar
// credentials are ownership-level configuration, like QBO connect. The key is
// AES-256-GCM encrypted before it touches the table and is validated with a
// live domain-wide-delegation check: a freebusy call impersonating the
// connecting admin. A DWD failure (delegation not yet authorized in the
// Google Admin console, or still propagating) saves the key but reports it,
// so the panel can say "authorized, waiting on Google" instead of lying.
export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { saJson?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.saJson?.trim()) {
    return NextResponse.json({ error: 'Paste the service-account JSON key.' }, { status: 400 })
  }

  let clientEmail: string
  try {
    ;({ clientEmail } = await saveGcalConnection(body.saJson.trim(), caller.email))
  } catch (e) {
    const message = e instanceof SyntaxError ? 'That is not valid JSON.' : e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Live DWD check, impersonating the admin who clicked (a Workspace user).
  let dwdOk = false
  let dwdError: string | null = null
  try {
    const conn = await loadGcalConnection()
    if (conn?.key) {
      const now = new Date()
      await freeBusy(conn.key, caller.email, null, now.toISOString(), new Date(now.getTime() + 3600_000).toISOString())
      dwdOk = true
    }
  } catch (e) {
    dwdError = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json({ ok: true, clientEmail, dwdOk, dwdError })
}
