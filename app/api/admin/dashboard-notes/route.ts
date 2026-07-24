import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'

// PL-133: the sticky-note layer. Add text, clear it when it's handled. That
// is the entire feature — no priorities, assignees, due dates, or
// categories, because the moment it grows fields it competes with real task
// tools and loses. A shared ops surface: admin and manager both add and
// clear, and everyone sees the same notes.
//
// "Done" keeps a trail rather than hard-deleting — the note that got cleared
// is sometimes exactly the one you need to remember.

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: { action?: 'add' | 'clear'; body?: string; id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (body.action === 'add') {
    const text = (body.body ?? '').trim()
    if (!text) return NextResponse.json({ error: 'Write something first.' }, { status: 400 })
    if (text.length > 2000) {
      return NextResponse.json({ error: 'Keep it under 2000 characters.' }, { status: 400 })
    }
    const { error } = await supabase
      .from('dashboard_notes')
      .insert([{ body: text, created_by: caller.email }])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'clear') {
    if (!body.id) return NextResponse.json({ error: 'Missing the note.' }, { status: 400 })
    const { error } = await supabase
      .from('dashboard_notes')
      .update({ cleared_at: new Date().toISOString(), cleared_by: caller.email })
      .eq('id', body.id)
      .is('cleared_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
