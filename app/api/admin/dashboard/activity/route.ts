import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { loadActivity } from '../../../../utils/dashboard-activity'

// PL-344: "Show earlier activity" — server-paged history for the dashboard
// feed, from the SAME builder that produces page one (grouping keys, copy,
// and deep links can't drift). `before` = the oldest loaded row's instant;
// `type` = the PL-134 chip filter, applied across the whole history so a
// filtered page is a page OF that type, not a sieve of 20 mixed rows.
export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(req.url)
  const before = url.searchParams.get('before')
  const type = url.searchParams.get('type')
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)))
  if (before && Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: 'Pass `before` as an ISO timestamp.' }, { status: 400 })
  }
  const page = await loadActivity({ before, limit, type })
  return NextResponse.json(page)
}
