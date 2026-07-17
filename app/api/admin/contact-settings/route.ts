import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { loadContactInfo } from '../../../utils/tutoring-emails'

// PL-50: the tutoring point-of-contact (name/email/phone in app_settings).
// ADMIN-ONLY both ways — who the contact person is is an ownership decision,
// so the manager role (Kelsie herself) neither sees nor edits this card.
// Reassigning the contact updates the §8 contact block on every parent
// surface and the From identity of the PL-40/41 schedule emails at once.

export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  return NextResponse.json({ contact: await loadContactInfo() })
}

export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Admin only.' }, { status: 403 })

  let body: { name?: string; email?: string; phone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const name = body.name?.trim()
  const email = body.email?.trim().toLowerCase()
  const phone = body.phone?.trim()
  if (!name || !email || !phone) {
    return NextResponse.json({ error: 'Name, email, and phone are all required.' }, { status: 400 })
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
  }

  const rows = [
    { key: 'contact_name', value: name },
    { key: 'contact_email', value: email },
    { key: 'contact_phone', value: phone },
  ].map((r) => ({ ...r, updated_at: new Date().toISOString() }))
  const { error } = await supabase.from('app_settings').upsert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
