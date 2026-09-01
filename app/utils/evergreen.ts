import { supabaseAdmin as supabase } from './supabase-admin'

// PL-384: THE evergreen-code resolver — one model, one resolution. A code
// belongs to a school or a course (plus the legacy registrar forwards);
// it serves its newest OPEN class (a pinned class wins while it is open —
// the two-open-classes escape hatch), and the interest-capture state when
// nothing is open. Every consumer (the /{code} page, /{code}/register, the
// sitemap, admin link builders) resolves through here.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EvergreenResolution =
  | { kind: 'legacy'; destination: string }
  | {
      kind: 'school'
      schoolId: string
      label: string
      classSlug: string | null
      classType: string
      pinned: boolean
    }
  | {
      kind: 'course'
      courseKey: string
      label: string
      classSlug: string | null
      classType: string
      pinned: boolean
    }
  | { kind: 'unknown' }

/** Pin wins while its class is OPEN with a slug; otherwise newest open. */
async function resolveClass(
  filter: { school_id?: string; course_key?: string },
  pinClassId: string | null
): Promise<{ slug: string | null; pinned: boolean }> {
  if (pinClassId) {
    const { data: pin } = await supabase
      .from('classes')
      .select('slug, status')
      .eq('id', pinClassId)
      .maybeSingle()
    if (pin?.status === 'open' && pin.slug) return { slug: pin.slug, pinned: true }
    // Closed/deleted pin → fall through to auto-resolution (never a dead link).
  }
  let q = supabase
    .from('classes')
    .select('slug, created_at')
    .eq('status', 'open')
    .not('slug', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (filter.school_id) q = q.eq('school_id', filter.school_id)
  if (filter.course_key) q = q.eq('course_key', filter.course_key).is('school_id', null)
  const { data } = await q
  return { slug: (data?.[0] as any)?.slug ?? null, pinned: false }
}

async function latestClassType(filter: { school_id?: string; course_key?: string }): Promise<string | null> {
  let q = supabase
    .from('classes')
    .select('class_type, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
  if (filter.school_id) q = q.eq('school_id', filter.school_id)
  if (filter.course_key) q = q.eq('course_key', filter.course_key).is('school_id', null)
  const { data } = await q
  return (data?.[0] as any)?.class_type ?? null
}

export async function resolveEvergreen(code: string): Promise<EvergreenResolution> {
  const { data: legacy } = await supabase
    .from('legacy_redirects')
    .select('destination')
    .eq('code', code)
    .maybeSingle()
  if (legacy?.destination) return { kind: 'legacy', destination: legacy.destination }

  const { data: school } = await supabase
    .from('schools')
    .select('id, name, nickname, evergreen_code, evergreen_pin_class_id')
    .eq('evergreen_code', code)
    .maybeSingle()
  if (school) {
    const { slug, pinned } = await resolveClass({ school_id: school.id }, school.evergreen_pin_class_id)
    return {
      kind: 'school',
      schoolId: school.id,
      label: school.nickname ?? school.name,
      classSlug: slug,
      classType: (await latestClassType({ school_id: school.id })) ?? 'SAT Prep',
      pinned,
    }
  }

  const { data: meta } = await supabase
    .from('course_meta')
    .select('course_key, display_name, evergreen_pin_class_id')
    .eq('evergreen_code', code)
    .maybeSingle()
  if (meta) {
    const { slug, pinned } = await resolveClass({ course_key: meta.course_key }, meta.evergreen_pin_class_id)
    const classType = await latestClassType({ course_key: meta.course_key })
    return {
      kind: 'course',
      courseKey: meta.course_key,
      label:
        meta.display_name ??
        classType ??
        meta.course_key.split('-').map((w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '),
      classSlug: slug,
      classType: classType ?? meta.course_key,
      pinned,
    }
  }

  return { kind: 'unknown' }
}

/** PL-350 continuity: the same per-code/day counter the shortcode layer
 *  used — the code STRINGS survived the fold, so history reads straight
 *  through. Best-effort by design. */
export async function bumpCodeVisit(code: string) {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  await supabase.rpc('bump_short_link_click', { p_code: code, p_day: day }).then(
    () => {},
    () => {}
  )
}

/** PL-448: the registrar-parity wildcard — hgl.co/{anything} that is not a
 *  reserved route, a code, or a legacy override 301s to the SAME path on the
 *  main site, replicating today's registrar forward exactly. Segments arrive
 *  decoded (Next params) and re-encode verbatim — case and all. */
export function wildcardForward(segments: string[]): string {
  const path = segments
    .map((s) => encodeURIComponent(decodeURIComponent(s)))
    .join('/')
  return `https://highergroundlearning.com/${path}`
}

/** The class-page URL internal surfaces should share: the permanent /{code}
 *  address when the class's school/course code currently RESOLVES to it,
 *  else its /c/{slug} internal address. Pass the base ('' for site-relative). */
export async function preferredClassPath(cls: {
  id: string
  slug: string | null
  school_id: string | null
  course_key?: string | null
}): Promise<string> {
  const fallback = `/c/${cls.slug ?? cls.id}`
  try {
    if (cls.school_id) {
      const { data: school } = await supabase
        .from('schools')
        .select('id, evergreen_code, evergreen_pin_class_id')
        .eq('id', cls.school_id)
        .maybeSingle()
      if (school?.evergreen_code) {
        const { slug } = await resolveClass({ school_id: school.id }, school.evergreen_pin_class_id)
        if (slug && slug === cls.slug) return `/${school.evergreen_code}`
      }
      return fallback
    }
    if (cls.course_key) {
      const { data: meta } = await supabase
        .from('course_meta')
        .select('course_key, evergreen_code, evergreen_pin_class_id')
        .eq('course_key', cls.course_key)
        .maybeSingle()
      if (meta?.evergreen_code) {
        const { slug } = await resolveClass({ course_key: meta.course_key }, meta.evergreen_pin_class_id)
        if (slug && slug === cls.slug) return `/${meta.evergreen_code}`
      }
    }
  } catch {
    // resolution is best-effort — the internal address always works
  }
  return fallback
}
