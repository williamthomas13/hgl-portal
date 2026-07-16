import { NextResponse } from 'next/server'
import { authorizeUrl } from '../../../utils/qbo'
import { sessionRole } from '../../../utils/staff-gate'

// Phase 6 §6: kick off the QuickBooks OAuth flow. Admin-only — connecting the
// accounting integration is ownership-level; managers never see this.
export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'QBO_CLIENT_ID / QBO_CLIENT_SECRET are not configured.' },
      { status: 500 }
    )
  }
  return NextResponse.redirect(await authorizeUrl())
}
