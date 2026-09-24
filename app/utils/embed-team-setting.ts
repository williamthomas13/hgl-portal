import { supabaseAdmin as supabase } from './supabase-admin'
import { defaultTeamSeed, type TeamMember } from './embed-team'

// PL-507: the homepage team strip's member list — app_settings
// `embed_team_members` (JSON array of instructor ids in order), SEEDED once
// with the first four in /team order (today: William · Eric · Jason ·
// Kelsie — the leadership entries) when the row is absent. Edited under
// Settings → Site content → "Homepage strip: team members".

export const TEAM_KEY = 'embed_team_members'

export function parseTeamSetting(raw: unknown): string[] | null {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return null
    return arr.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x))
  } catch {
    return null
  }
}

export type TeamRow = TeamMember & { public_name: string | null; headshot: unknown }

export async function loadTeamRows(): Promise<TeamRow[]> {
  const { data } = await supabase
    .from('instructors')
    .select('id, name, public_name, credential, headshot, show_on_team, team_order')
    .order('team_order', { ascending: true, nullsFirst: false })
    .order('name')
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map((p) => ({
    ...p,
    // PL-365: public surfaces render public_name when set.
    name: (typeof p.public_name === 'string' && p.public_name.trim()) || p.name,
    show_on_team: Boolean(p.show_on_team),
  }))
}

/** The ordered member ids; seeds the setting from /team order when unset. */
export async function loadTeamSetting(rows: TeamRow[]): Promise<string[]> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', TEAM_KEY).maybeSingle()
  const parsed = parseTeamSetting(data?.value)
  if (parsed) return parsed
  const seeded = defaultTeamSeed(rows, 4)
  if (data == null) {
    await supabase
      .from('app_settings')
      .upsert({ key: TEAM_KEY, value: JSON.stringify(seeded), updated_at: new Date().toISOString() })
      .then(() => {}, () => {})
  }
  return seeded
}
