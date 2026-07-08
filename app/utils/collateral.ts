import { supabaseAdmin } from './supabase-admin'

// Phase 4.5 collateral data layer (docs/hgl-phase4.5-collateral-spec.md §3).
// Loads one class into the template model both artifacts render from. All
// computed values live here — collateral is a *view* of the class data, so
// nothing here is ever stored back.

export type CollateralLanguage = 'en' | 'es'
export type CollateralType = 'flyer' | 'letter'

type SessionRow = {
  session_date: string
  start_time: string | null
  end_time: string | null
}

export type CollateralModel = {
  classId: string
  slug: string
  classType: string
  examName: string
  inPerson: boolean
  capacity: number
  practiceTestCount: number

  schoolName: string
  schoolNickname: string
  schoolLogoUrl: string | null
  accentColor: string

  // 'en' | 'es' | 'both' after applying the class override to the school default
  languageSetting: 'en' | 'es' | 'both'

  shortLink: string | null // as stored, e.g. "hgl.co/asf"
  registerUrl: string // absolute /register/{slug}?src=flyer — QR target
  /** What prints where the short link goes: the short link, else the full registration URL. */
  linkDisplay: string

  flyerBlurb: string | null
  letterBlurb: string | null // EN blurb
  letterBlurbEs: string | null

  promo: { code: string; amount: string; deadline: string } | null // deadline = ISO
  enrollmentDeadline: string | null // ISO

  sessions: SessionRow[]
  firstSession: string
  lastSession: string
  classroomHours: string | null // "14" / "14.5", null when no timed sessions
  /** Unique start–end blocks in start order; 1 = simple, 2 = split (AISCT). */
  timeBlocks: { start: string; end: string | null }[]
  weekdayNumbers: number[] // distinct, 0=Sunday..6=Saturday, in week order Mon-first
  weeksUntilStart: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

const HGL_BLUE = '#00AEEE'

export function examNameFor(classType: string): string {
  if (/sat/i.test(classType)) return 'SAT'
  if (/act/i.test(classType)) return 'ACT'
  return classType
}

export async function loadCollateralModel(classId: string): Promise<CollateralModel | null> {
  const { data: c, error } = await supabaseAdmin
    .from('classes')
    .select(
      `
      id, slug, class_type, delivery_mode, capacity, start_date,
      short_link, collateral_language, letter_blurb, letter_blurb_es,
      flyer_blurb, practice_test_count, promo_code, promo_amount, promo_deadline,
      enrollment_deadline,
      schools ( name, nickname, logo_url, accent_color, collateral_language ),
      sessions ( session_date, start_time, end_time )
    `
    )
    .eq('id', classId)
    .single()
  if (error || !c) return null

  const school = one<any>(c.schools)
  const sessions: SessionRow[] = [...((c.sessions ?? []) as SessionRow[])].sort((a, b) =>
    a.session_date.localeCompare(b.session_date)
  )
  const firstSession = sessions[0]?.session_date ?? c.start_date
  const lastSession = sessions[sessions.length - 1]?.session_date ?? c.start_date

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const slug = c.slug ?? c.id
  const registerUrl = `${base}/register/${slug}?src=flyer`
  const shortLink = (c.short_link ?? '').trim() || null

  const promoComplete = c.promo_code && c.promo_amount != null && c.promo_deadline
  const languageSetting = (c.collateral_language ??
    school?.collateral_language ??
    'en') as CollateralModel['languageSetting']

  return {
    classId: c.id,
    slug,
    classType: c.class_type,
    examName: examNameFor(c.class_type),
    inPerson: c.delivery_mode !== 'online',
    capacity: c.capacity,
    practiceTestCount: c.practice_test_count ?? 2,
    schoolName: school?.name ?? 'your school',
    schoolNickname: school?.nickname ?? school?.name ?? 'Your school',
    schoolLogoUrl: school?.logo_url || null,
    accentColor: school?.accent_color || HGL_BLUE,
    languageSetting,
    shortLink,
    registerUrl,
    linkDisplay: shortLink ?? `${base.replace(/^https?:\/\//, '')}/register/${slug}`,
    flyerBlurb: c.flyer_blurb || null,
    letterBlurb: c.letter_blurb || null,
    letterBlurbEs: c.letter_blurb_es || null,
    promo: promoComplete
      ? { code: c.promo_code, amount: formatMoney(Number(c.promo_amount)), deadline: c.promo_deadline }
      : null,
    enrollmentDeadline: c.enrollment_deadline ?? null,
    sessions,
    firstSession,
    lastSession,
    classroomHours: classroomHoursFor(sessions),
    timeBlocks: timeBlocksFor(sessions),
    weekdayNumbers: weekdaysFor(sessions),
    weeksUntilStart: Math.round((utc(firstSession).getTime() - Date.now()) / (7 * 86400_000)),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Effective render language(s) for a class. */
export function languagesFor(m: CollateralModel): CollateralLanguage[] {
  return m.languageSetting === 'both' ? ['en', 'es'] : [m.languageSetting]
}

// ---------------------------------------------------------------------------
// Computed values (spec §3, "Computed (never stored)")
// ---------------------------------------------------------------------------

function utc(iso: string): Date {
  return new Date(iso.slice(0, 10) + 'T12:00:00Z')
}

function formatMoney(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`
}

function classroomHoursFor(sessions: SessionRow[]): string | null {
  let minutes = 0
  for (const s of sessions) {
    if (!s.start_time || !s.end_time) continue
    const [sh, sm] = s.start_time.split(':').map(Number)
    const [eh, em] = s.end_time.split(':').map(Number)
    const d = eh * 60 + em - (sh * 60 + sm)
    if (d > 0) minutes += d
  }
  if (minutes === 0) return null
  const hours = minutes / 60
  const rounded = Math.round(hours * 2) / 2 // half-hour precision
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function timeBlocksFor(sessions: SessionRow[]): { start: string; end: string | null }[] {
  const timed = sessions.filter((s) => s.start_time)
  if (timed.length === 0 || timed.length !== sessions.length) return []
  const unique = new Map<string, { start: string; end: string | null }>()
  for (const s of timed) {
    unique.set(`${s.start_time}|${s.end_time ?? ''}`, {
      start: s.start_time as string,
      end: s.end_time ?? null,
    })
  }
  // 1 block = one shared time; 2 = split blocks (AISCT morning|afternoon).
  // More than 2 distinct times isn't a "class time" — templates fall back.
  if (unique.size > 2) return []
  return [...unique.values()].sort((a, b) => a.start.localeCompare(b.start))
}

/** Distinct session weekdays in Monday-first order; [] = no consistent pattern. */
function weekdaysFor(sessions: SessionRow[]): number[] {
  if (sessions.length < 2) return []
  const days = new Set(sessions.map((s) => utc(s.session_date).getUTCDay()))
  if (days.size > 3) return [] // spread over the week — no printable pattern
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
}

// ---------------------------------------------------------------------------
// Language-aware formatting (templates only — keep locale quirks out of them)
// ---------------------------------------------------------------------------

const LOCALE: Record<CollateralLanguage, string> = { en: 'en-US', es: 'es-MX' }

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// AP-style month abbreviations, matching the approved flyers ("SEPT" not "SEP").
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']

/** "Sept 14 - Oct 01, 2026" (flyer EN) · "14 Sept - 01 Oct 2026" (flyer ES). */
export function flyerDateRange(m: CollateralModel, lang: CollateralLanguage): string {
  const a = utc(m.firstSession)
  const b = utc(m.lastSession)
  const month = (d: Date) =>
    lang === 'en'
      ? MONTH_SHORT_EN[d.getUTCMonth()]
      : cap(d.toLocaleDateString(LOCALE[lang], { month: 'short', timeZone: 'UTC' }).replace(/\.$/, ''))
  const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0')
  if (lang === 'es') {
    if (a.getTime() === b.getTime()) return `${dd(a)} ${month(a)} ${b.getUTCFullYear()}`
    return `${dd(a)} ${month(a)} - ${dd(b)} ${month(b)} ${b.getUTCFullYear()}`
  }
  if (a.getTime() === b.getTime()) return `${month(a)} ${dd(a)}, ${a.getUTCFullYear()}`
  return `${month(a)} ${dd(a)} - ${month(b)} ${dd(b)}, ${b.getUTCFullYear()}`
}

/** "14 September - 01 October, 2026" (letter EN) · "14 Septiembre - 01 Octubre 2026" (ES, per Nido). */
export function letterDateRange(m: CollateralModel, lang: CollateralLanguage): string {
  const a = utc(m.firstSession)
  const b = utc(m.lastSession)
  const month = (d: Date) => cap(d.toLocaleDateString(LOCALE[lang], { month: 'long', timeZone: 'UTC' }))
  const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0')
  if (lang === 'es') {
    if (a.getTime() === b.getTime()) return `${dd(a)} ${month(a)} ${b.getUTCFullYear()}`
    return `${dd(a)} ${month(a)} - ${dd(b)} ${month(b)} ${b.getUTCFullYear()}`
  }
  if (a.getTime() === b.getTime()) return `${dd(a)} ${month(a)}, ${a.getUTCFullYear()}`
  return `${dd(a)} ${month(a)} - ${dd(b)} ${month(b)}, ${b.getUTCFullYear()}`
}

/** "31 May" · "31 de mayo" — deadline callouts (year added where the copy needs it). */
export function dayMonth(iso: string, lang: CollateralLanguage, withYear = false): string {
  const d = utc(iso)
  if (lang === 'es') {
    const month = d.toLocaleDateString('es-MX', { month: 'long', timeZone: 'UTC' })
    return `${d.getUTCDate()} de ${month}${withYear ? ` de ${d.getUTCFullYear()}` : ''}`
  }
  const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  return `${d.getUTCDate()} ${month}${withYear ? ` ${d.getUTCFullYear()}` : ''}`
}

/** "September 2026" — letter summary box heading (EN). */
export function monthYearLabel(iso: string, lang: CollateralLanguage): string {
  return cap(utc(iso).toLocaleDateString(LOCALE[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' }))
}

const DAY_PLURAL_EN = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const DAY_PLURAL_ES = ['Domingos', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábados']

/** "Tuesdays & Thursdays" · "Martes y Jueves" — null when there's no pattern. */
export function dayPattern(m: CollateralModel, lang: CollateralLanguage): string | null {
  if (m.weekdayNumbers.length === 0) return null
  const names = m.weekdayNumbers.map((n) => (lang === 'es' ? DAY_PLURAL_ES[n] : DAY_PLURAL_EN[n]))
  const glue = lang === 'es' ? ' y ' : ' & '
  if (names.length <= 2) return names.join(glue)
  return `${names.slice(0, -1).join(', ')}${glue}${names[names.length - 1]}`
}

function fmt12h(t: string): { text: string; meridiem: 'AM' | 'PM' } {
  const [h, m] = t.split(':').map(Number)
  const meridiem = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return { text: `${hour}:${String(m).padStart(2, '0')}`, meridiem }
}

/**
 * "2:45 PM - 4:00 PM" · split blocks "9:30 - 11:30 AM | 12:30 - 2:30 PM".
 * Same rendering both languages (the Nido letter prints am/pm too); the
 * joiner differs (flyer "|", letter "&"). Null when times are inconsistent.
 */
export function classTime(m: CollateralModel, joiner: string): string | null {
  if (m.timeBlocks.length === 0) return null
  const compact = m.timeBlocks.length > 1 // split blocks print tighter
  const parts = m.timeBlocks.map((b) => {
    const s = fmt12h(b.start)
    if (!b.end) return `${s.text} ${s.meridiem}`
    const e = fmt12h(b.end)
    // Split blocks: "9:30-11:30 AM" · single range: "2:45 PM - 4:00 PM"
    if (compact) {
      return s.meridiem === e.meridiem
        ? `${s.text}-${e.text} ${e.meridiem}`
        : `${s.text} ${s.meridiem}-${e.text} ${e.meridiem}`
    }
    return `${s.text} ${s.meridiem} - ${e.text} ${e.meridiem}`
  })
  return parts.join(` ${joiner} `)
}

/**
 * Flyer intro duration: "a 4-week" / "a 2-weekend" / "an upcoming" (EN);
 * " de 4 semanas" / " de 2 fines de semana" / "" (ES suffix). Weekend classes
 * are ones meeting only Sat/Sun; everything else counts calendar weeks.
 */
export function durationPhrase(m: CollateralModel, lang: CollateralLanguage): string {
  const spanDays = (utc(m.lastSession).getTime() - utc(m.firstSession).getTime()) / 86400_000 + 1
  const weeks = Math.max(1, Math.ceil(spanDays / 7))
  const weekendOnly =
    m.weekdayNumbers.length > 0 && m.weekdayNumbers.every((d) => d === 0 || d === 6)
  // Irregular pattern (no printable weekdays) or a single session -> the
  // copy-deck fallback: "an upcoming ... course" / no duration suffix in ES.
  if (m.sessions.length < 2 || m.weekdayNumbers.length === 0) {
    return lang === 'es' ? '' : 'an upcoming'
  }
  if (weekendOnly) {
    if (lang === 'es') return weeks === 1 ? ' de un fin de semana' : ` de ${weeks} fines de semana`
    return weeks === 1 ? 'a 1-weekend' : `a ${weeks}-weekend`
  }
  if (lang === 'es') return weeks === 1 ? ' de una semana' : ` de ${weeks} semanas`
  return weeks === 1 ? 'a 1-week' : `a ${weeks}-week`
}

/** Download filename matching the historical convention, e.g. "Flyer_ASF SAT Prep - September 2026". */
export function collateralFilename(m: CollateralModel, type: CollateralType, lang: CollateralLanguage): string {
  const prefix = type === 'flyer' ? 'Flyer' : lang === 'es' ? 'Carta' : 'Parent Letter'
  const month = monthYearLabel(m.firstSession, lang)
  const suffix = m.languageSetting === 'both' ? ` (${lang.toUpperCase()})` : ''
  return `${prefix}_${m.schoolNickname} ${m.classType} - ${month}${suffix}`.replace(/[^\w\- ()]+/g, '')
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
