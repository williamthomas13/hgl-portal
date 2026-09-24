import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { PRIORITY_KEY, loadPrioritySchools, parsePriority } from '../../../utils/embed-priority'
import { TEAM_KEY, loadTeamRows, loadTeamSetting, parseTeamSetting } from '../../../utils/embed-team-setting'
import { TEAM_EMBED_CAP } from '../../../utils/embed-team'

// PL-506/507: the homepage strips' settings — the priority-school list and
// the team-member list — read (with the pickers' options) and written.
// Admin only: these decide what the marketing site shows.
export async function GET() {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  const [priority, { data: schools }, team] = await Promise.all([
    loadPrioritySchools(),
    supabase.from('schools').select('id, name, nickname').order('nickname'),
    loadTeamRows(),
  ])
  const members = await loadTeamSetting(team)
  return NextResponse.json({
    priority,
    schools: schools ?? [],
    members,
    // only people shown on /team are selectable
    people: team.filter((p) => p.show_on_team).map((p) => ({ id: p.id, name: p.name, credential: p.credential })),
    teamCap: TEAM_EMBED_CAP,
  })
}

export async function POST(req: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return NextResponse.json({ error: 'Admin only.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const stamp = { updated_by: caller.email, updated_at: new Date().toISOString() }

  if (body?.action === 'set_team_members') {
    const ids = parseTeamSetting(body?.members)
    if (!ids) return NextResponse.json({ error: 'members must be a list of instructor ids.' }, { status: 400 })
    if (ids.length > TEAM_EMBED_CAP) return NextResponse.json({ error: `At most ${TEAM_EMBED_CAP} people on the homepage strip.` }, { status: 400 })
    const rows = await loadTeamRows()
    const shown = new Set(rows.filter((p) => p.show_on_team).map((p) => p.id))
    const clean = [...new Set(ids.filter((id) => shown.has(id)))]
    const { error } = await supabase.from('app_settings').upsert({ key: TEAM_KEY, value: JSON.stringify(clean), ...stamp })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, members: clean })
  }

  const ids = parsePriority(body?.priority)
  if (!ids) return NextResponse.json({ error: 'priority must be a list of school ids.' }, { status: 400 })
  const { data: known } = await supabase.from('schools').select('id').in('id', ids)
  const knownIds = new Set(((known ?? []) as { id: string }[]).map((s) => s.id))
  const clean = [...new Set(ids.filter((id) => knownIds.has(id)))]
  const { error } = await supabase.from('app_settings').upsert({ key: PRIORITY_KEY, value: JSON.stringify(clean), ...stamp })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, priority: clean })
}
