import { NextResponse } from 'next/server'
import { QboApiError, listBankAccounts, listEmployees, listItems } from '../../../utils/qbo'
import { sessionRole } from '../../../utils/staff-gate'

// Live QBO Items (for the group-class / tutoring mappings), bank-type
// Accounts (for Stripe Clearing), and — PL-281 — active Employees (for the
// tutor matching). Admin-only, same boundary as the mapping writes.
export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  try {
    const [items, accounts, employees] = await Promise.all([
      listItems(),
      listBankAccounts(),
      listEmployees(),
    ])
    return NextResponse.json({ items, accounts, employees })
  } catch (e) {
    if (e instanceof QboApiError && e.status === 0) {
      return NextResponse.json({ error: 'QuickBooks is not connected.' }, { status: 409 })
    }
    console.error('QBO catalog failed:', e)
    return NextResponse.json({ error: 'Could not load Items from QuickBooks.' }, { status: 502 })
  }
}
