// PL-328: ONE source for the class display label wherever the
// school-abbreviation pattern renders (roster tabs, card headers, pickers,
// dashboards). School classes keep the nickname pattern ("ISD SAT Prep");
// no-school classes stop rendering as "— PSAT Prep":
//   in-person at HGL → "HGL " + short name       ("HGL PSAT Prep")
//   online           → "Online " + short marketing name, full name fallback
//                                                 ("Online SAT Math Deep Dive")
// Reconciled with PL-290's no-"HGL"-prefix rule for ADMIN EMAIL copy: pass
// { internalEmail: true } and the at-HGL prefix drops (saying "HGL" to
// ourselves is noise) — the "Online " prefix stays everywhere (it carries
// real information). Leaf-safe: no imports.

export function classDisplayLabel(
  cls: {
    schoolNickname: string | null
    deliveryMode: string | null
    /** The class's short marketing name (fo_short_name), when set. */
    shortName?: string | null
    classType: string
  },
  opts: { internalEmail?: boolean } = {}
): string {
  if (cls.schoolNickname) return `${cls.schoolNickname} ${cls.classType}`
  const short = cls.shortName?.trim() || cls.classType
  if (cls.deliveryMode === 'online') return `Online ${short}`
  // In-person, no school = at Higher Ground.
  return opts.internalEmail ? short : `HGL ${short}`
}
