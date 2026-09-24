import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { PRIORITY_KEY, loadPrioritySchools, parsePriority } from '../../../utils/embed-priority'

// PL-506: the homepage strip's priority-school list — read (with every
// school for the picker) and write. Admin only: the ordering decides what
// the marketing site shows first.
export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  const [priority, { data: schools }] = await Promise.all([
    loadPrioritySchools(),
    supabase.from('schools').select('id, name, nickname').order('nickname'),
  ])
  return NextResponse.json({ priority, schools: schools ?? [] })
}

export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const ids = parsePriority(body?.priority)
  if (!ids) return NextResponse.json({ error: 'priority must be a list of school ids.' }, { status: 400 })
  const { data: known } = await supabase.from('schools').select('id').in('id', ids)
  const knownIds = new Set(((known ?? []) as { id: string }[]).map((s) => s.id))
  const clean = [...new Set(ids.filter((id) => knownIds.has(id)))]
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: PRIORITY_KEY, value: JSON.stringify(clean), updated_by: caller.email, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, priority: clean })
}
