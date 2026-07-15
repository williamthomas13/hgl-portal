import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { generateMonthlyCycle, sweepProposals } from '../../../../utils/tutoring-billing'
import { sweepCollections } from '../../../../utils/tutoring-stripe'

// Manual cycle controls (Phase 7c). The cron owns the schedule; this lets
// the Ops Director run generation off-cycle (a family joining mid-month, or
// QA against a specific month) and kick the sweeps without waiting a day.
// Body: { action: 'generate', month?: 'YYYY-MM' } | { action: 'sweep' }

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { action?: 'generate' | 'sweep'; month?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  try {
    if (body.action === 'generate') {
      if (body.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) {
        return NextResponse.json({ error: 'Month must look like 2026-09.' }, { status: 400 })
      }
      const result = await generateMonthlyCycle(new Date(), body.month)
      return NextResponse.json({ ok: true, ...result })
    }
    if (body.action === 'sweep') {
      const proposals = await sweepProposals()
      const collections = await sweepCollections()
      return NextResponse.json({ ok: true, ...proposals, ...collections })
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('tutoring cycle route failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
