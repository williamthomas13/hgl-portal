// Client-safe collateral copy helpers — NO server imports (the admin
// Collateral card uses these to show computed defaults as placeholders, and
// the server data layer builds the real render model on top of them).

import type { CollateralLanguage } from './collateral-types'

export type { CollateralLanguage }

function utc(iso: string): Date {
  return new Date(iso.slice(0, 10) + 'T12:00:00Z')
}

export function examNameFor(classType: string): string {
  if (/sat/i.test(classType)) return 'SAT'
  if (/act/i.test(classType)) return 'ACT'
  return classType
}

/** Distinct weekdays (0=Sun..6=Sat) in Monday-first order; [] = no printable
 *  pattern (spread over more than 3 weekdays, or fewer than 2 sessions). */
export function weekdayNumbersFromDates(dates: string[]): number[] {
  if (dates.length < 2) return []
  const days = new Set(dates.map((d) => utc(d).getUTCDay()))
  if (days.size > 3) return []
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
}

/**
 * Flyer intro duration: "a 4-week" / "a 2-weekend" / "an upcoming" (EN);
 * " de 4 semanas" / " de 2 fines de semana" / "" (ES suffix). Weekend classes
 * are ones meeting only Sat/Sun; everything else counts calendar weeks.
 * Irregular patterns (no printable weekdays) fall back per the copy deck.
 */
export function durationPhraseFromDates(dates: string[], lang: CollateralLanguage): string {
  const sorted = [...dates].sort()
  const weekdays = weekdayNumbersFromDates(sorted)
  if (sorted.length < 2 || weekdays.length === 0) {
    return lang === 'es' ? '' : 'an upcoming'
  }
  const spanDays =
    (utc(sorted[sorted.length - 1]).getTime() - utc(sorted[0]).getTime()) / 86400_000 + 1
  const weeks = Math.max(1, Math.ceil(spanDays / 7))
  const weekendOnly = weekdays.every((d) => d === 0 || d === 6)
  if (weekendOnly) {
    if (lang === 'es') return weeks === 1 ? ' de un fin de semana' : ` de ${weeks} fines de semana`
    return weeks === 1 ? 'a 1-weekend' : `a ${weeks}-weekend`
  }
  if (lang === 'es') return weeks === 1 ? ' de una semana' : ` de ${weeks} semanas`
  return weeks === 1 ? 'a 1-week' : `a ${weeks}-week`
}

/** The standard flyer intro sentence (copy deck F-EN/F-ES) as plain text —
 *  what renders when flyer_blurb is blank. */
export function flyerIntroDefault(opts: {
  schoolNickname: string
  classType: string
  inPerson: boolean
  sessionDates: string[]
  lang: CollateralLanguage
}): string {
  const exam = examNameFor(opts.classType)
  const nick = opts.schoolNickname
  if (opts.lang === 'es') {
    const mode = opts.inPerson ? `presencial, impartido en ${nick}` : 'en vivo y en línea'
    return `${nick} se ha asociado con Higher Ground Learning para ofrecer un curso de preparación para el ${exam} ${mode}${durationPhraseFromDates(opts.sessionDates, 'es')}.`
  }
  const dur = durationPhraseFromDates(opts.sessionDates, 'en')
  const mode = opts.inPerson ? 'in-person' : 'live online'
  const taughtAt = opts.inPerson ? ` taught at ${nick}` : ''
  return `${nick} has partnered with Higher Ground Learning to offer ${dur} ${mode} ${exam} prep course${taughtAt}.`
}
