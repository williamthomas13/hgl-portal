// PL-508 (Scarlett, Sep 24): the logo-less school tile shows the school's
// NICKNAME ("Nido", "SAS") — the short name people actually use — never
// initials of the full name ("CNA" for Colegio Nido de Aguilas is nobody's
// name). Initials remain only for a school with no nickname. ONE rule for
// the /classes SchoolTile and the homepage strip's inline tile.
export function schoolMonogram(nickname: string | null | undefined, name: string): string {
  const nick = (nickname ?? '').trim()
  if (nick) return nick.length > 8 ? nick.slice(0, 8) : nick
  return (
    name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and|de|del|di|la|le|du)$/i.test(w))
      .map((w) => w[0].toUpperCase())
      .slice(0, 3)
      .join('') || 'HGL'
  )
}
