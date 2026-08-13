import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { previewMonthlyCycle, loadCycleSettings } from '../../../../utils/tutoring-billing'

// PL-333 A: the invoices panel's upcoming-month projection — computed by
// previewMonthlyCycle (the generator's own building blocks, read-only), so
// what Kelsie sees before the generate day is what the run will create.
// Families whose invoice already exists are excluded (they render as real
// rows), so the section empties itself once generation runs.
export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const [preview, settings] = await Promise.all([
    previewMonthlyCycle(new Date()),
    loadCycleSettings(),
  ])
  return NextResponse.json({ preview, generateDay: settings.generateDay })
}
