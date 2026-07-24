import { NextResponse } from 'next/server'
import { sendCoverageNote, verifyCoverageNoteToken } from '../../../utils/coverage'

// PL-156: POST-only. The emailed button opens the form; only this route
// sends, and only from a JS-executed submit — a link prefetcher or mail
// scanner following the button can never deliver a note (the PL-62 rule).
// The token is the authorization: it is scoped to one coverage request and
// carries its own lifetime (PL-149).

export async function POST(req: Request) {
  let body: { token?: string; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.token || typeof body.note !== 'string') {
    return NextResponse.json({ error: 'Missing the note.' }, { status: 400 })
  }

  const verified = verifyCoverageNoteToken(body.token)
  if (verified === 'expired') {
    return NextResponse.json(
      { error: "This link has aged out. Open your portal, or write to us and we'll pass it along." },
      { status: 403 }
    )
  }
  if (verified === 'invalid') {
    return NextResponse.json({ error: "That link didn't work." }, { status: 403 })
  }

  const result = await sendCoverageNote({ requestId: verified.id, note: body.note })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, subFirstName: result.subFirstName })
}
