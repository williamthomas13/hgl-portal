// PL-507 (Scarlett, Sep 24): who the homepage "Meet our team" strip shows —
// ONE pure rule the embed route and regress:embed-team both run. The
// setting is an ORDERED list of instructor ids; the strip honours that order,
// drops anyone no longer shown on /team (show_on_team false — hiding someone
// from /team hides them from the homepage automatically), ignores ids that
// no longer exist, and caps at 12. Nothing chosen → an empty strip (headline
// + button only, never a hole).

export const TEAM_EMBED_CAP = 12

export type TeamMember = {
  id: string
  name: string
  credential: string | null
  show_on_team: boolean
  team_order: number | null
}

export function selectTeam<T extends TeamMember>(setting: string[], people: T[]): T[] {
  const byId = new Map(people.map((p) => [p.id, p]))
  const out: T[] = []
  for (const id of setting) {
    const p = byId.get(id)
    if (!p || !p.show_on_team || out.includes(p)) continue
    out.push(p)
    if (out.length >= TEAM_EMBED_CAP) break
  }
  return out
}

/** The seed: the first `count` people in /team order (team_order, then name). */
export function defaultTeamSeed<T extends TeamMember>(people: T[], count = 4): string[] {
  return [...people]
    .filter((p) => p.show_on_team)
    .sort((a, b) => (a.team_order ?? 1e9) - (b.team_order ?? 1e9) || a.name.localeCompare(b.name))
    .slice(0, count)
    .map((p) => p.id)
}
