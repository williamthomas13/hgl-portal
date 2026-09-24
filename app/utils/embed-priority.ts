import { supabaseAdmin as supabase } from './supabase-admin'

// PL-506: the priority-school list for the homepage strip — an admin setting
// (app_settings `embed_priority_schools`, a JSON array of school ids in
// order) seeded ONCE with Scarlett's six (matched by nickname at seed time,
// stored as ids — never nickname text at read time). Edited under Settings →
// Site content → "Homepage strip: priority schools".

export const DEFAULT_PRIORITY_NICKNAMES = ['Nido', 'AISCT', 'SAS', 'ASM', 'MIS', 'ISD']
export const PRIORITY_KEY = 'embed_priority_schools'

export function parsePriority(raw: unknown): string[] | null {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return null
    return arr.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x))
  } catch {
    return null
  }
}

/** The ordered school ids; seeds the setting from the six nicknames when unset. */
export async function loadPrioritySchools(): Promise<string[]> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', PRIORITY_KEY).maybeSingle()
  const parsed = parsePriority(data?.value)
  if (parsed) return parsed
  const { data: schools } = await supabase.from('schools').select('id, nickname').in('nickname', DEFAULT_PRIORITY_NICKNAMES)
  const byNick = new Map(((schools ?? []) as { id: string; nickname: string }[]).map((s) => [s.nickname.toLowerCase(), s.id]))
  const seeded = DEFAULT_PRIORITY_NICKNAMES.map((n) => byNick.get(n.toLowerCase())).filter((id): id is string => Boolean(id))
  if (data == null) {
    await supabase
      .from('app_settings')
      .upsert({ key: PRIORITY_KEY, value: JSON.stringify(seeded), updated_at: new Date().toISOString() })
      .then(() => {}, () => {})
  }
  return seeded
}
