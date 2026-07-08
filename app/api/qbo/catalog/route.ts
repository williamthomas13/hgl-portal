import { NextResponse } from 'next/server'
import { QboApiError, listBankAccounts, listItems } from '../../../utils/qbo'
import { sessionRole } from '../../../utils/staff-gate'

// Live QBO Items (for the group-class / tutoring mappings) and bank-type
// Accounts (for Stripe Clearing) to populate the mapping dropdowns (spec §3,
// §7). Admin-only, same boundary as the mapping writes.
export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  try {
    const [items, accounts] = await Promise.all([listItems(), listBankAccounts()])
    return NextResponse.json({ items, accounts })
  } catch (e) {
    if (e instanceof QboApiError && e.status === 0) {
      return NextResponse.json({ error: 'QuickBooks is not connected.' }, { status: 409 })
    }
    console.error('QBO catalog failed:', e)
    return NextResponse.json({ error: 'Could not load Items from QuickBooks.' }, { status: 502 })
  }
}
