import { permanentRedirect, redirect } from 'next/navigation'
import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import { ClassStateCard } from '../components/ClassStateCard'
import EvergreenCapture from '../components/EvergreenCapture'
import { pontano } from '../components/public-skin'

// PL-349: hgl.co/{code} — the shortlink resolver. A known code 302s (Next's
// temporary redirect) to its class's public /c/{slug} page carrying
// ?via={code} so PL-350 can count shortlink arrivals; the click is counted
// per code/day here first. Unknown or idle codes render the PL-348 honest
// no-active-class card — printed collateral must NEVER land on a 404.
//
// This is a root-level dynamic segment: every static route (/admin, /c,
// /register, /classes, …) wins over it, so it only catches the leftovers —
// exactly the shortcode namespace. It serves on the portal domain today;
// pointing hgl.co's DNS here is the launch-tail cutover documented in the
// batch doc (PL-155b ordered pair), not something this code performs.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** next's redirect()/permanentRedirect() throw a control-flow error — our
 *  fail-soft try/catches must rethrow it, never swallow it. */
function isRedirectError(e: unknown): boolean {
  return typeof (e as { digest?: string })?.digest === 'string' && String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT')
}
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

async function honestCard(schoolId: string | null) {
  // School-flavored when the code belongs to a school; copy is the shared
  // PL-348 states block when available, with a safe fallback.
  let heading = 'No active class right now'
  let body =
    "There's no class open for registration at this link right now. Talk to us directly and we'll point you toward the right prep option for your student."
  try {
    const { data: blk } = await supabase
      .from('site_content_blocks')
      .select('heading, body_markdown')
      .eq('key', 'no-active-class')
      .maybeSingle()
    if (blk?.heading) heading = blk.heading
    if (blk?.body_markdown) body = blk.body_markdown
  } catch {
    // seeds not applied yet — the fallback copy stands
  }
  if (schoolId) {
    const { data: school } = await supabase
      .from('schools')
      .select('nickname, name')
      .eq('id', schoolId)
      .maybeSingle()
    const name = school?.nickname ?? school?.name
    if (name) heading = `No active ${name} class right now`
  }
  return <ClassStateCard title={heading} body={body} />
}

export default async function ShortlinkPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code: raw } = await params
  const code = decodeURIComponent(raw).toLowerCase().trim()
  if (!/^[a-z0-9-]{1,32}$/.test(code)) {
    return honestCard(null)
  }

  let row: any = null
  try {
    const { data } = await supabase
      .from('short_links')
      .select('code, class_id, school_id, classes ( slug, school_id )')
      .eq('code', code)
      .maybeSingle()
    row = data
  } catch {
    row = null // table not migrated yet — every code falls through honestly
  }

  if (!row) {
    // PL-378 amendment: hgl.co legacy registrar forwards survive the DNS
    // cutover as 301s (admin-editable in the Shortlinks panel).
    try {
      const { data: legacy } = await supabase
        .from('legacy_redirects')
        .select('destination')
        .eq('code', code)
        .maybeSingle()
      if (legacy?.destination) permanentRedirect(legacy.destination)
    } catch (e) {
      if (isRedirectError(e)) throw e
    }

    // JSX renders outside the try/catch blocks (a component error would not
    // be caught there anyway — lint rule) — the tries only compute props.
    let capture: { schoolId: string | null; classType: string; heading: string; sub: string } | null = null
    const renderCapture = (c: NonNullable<typeof capture>) => (
      <div className={`min-h-screen bg-gray-50 ${pontano.className}`}>
        <EvergreenCapture schoolId={c.schoolId} classType={c.classType} heading={c.heading} sub={c.sub} />
      </div>
    )

    // PL-378 B: permanent per-SCHOOL links — newest OPEN class, else the
    // school-branded interest capture. These links NEVER 404 (logos,
    // counselor bookmarks, old emails).
    try {
      const { data: school } = await supabase
        .from('schools')
        .select('id, name, nickname')
        .eq('evergreen_code', code)
        .maybeSingle()
      if (school) {
        const { data: openCls } = await supabase
          .from('classes')
          .select('slug, created_at')
          .eq('school_id', school.id)
          .eq('status', 'open')
          .not('slug', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
        if (openCls?.[0]?.slug) redirect(`/c/${openCls[0].slug}?via=${encodeURIComponent(code)}`)
        // Interest rows key on the class type the family would be notified
        // about — the school's most recent class's type.
        const { data: lastCls } = await supabase
          .from('classes')
          .select('class_type, created_at')
          .eq('school_id', school.id)
          .order('created_at', { ascending: false })
          .limit(1)
        const label = school.nickname ?? school.name
        capture = {
          schoolId: school.id,
          classType: lastCls?.[0]?.class_type ?? 'SAT Prep',
          heading: `No upcoming class at ${label} right now`,
          sub: "Leave your email and we'll let you know the moment the next class opens for registration — nothing else, no newsletter.",
        }
      }
    } catch (e) {
      if (isRedirectError(e)) throw e
    }
    if (capture) return renderCapture(capture)

    // PL-378 C: permanent per-COURSE links (no-school courses) — newest open
    // class of the course, else the interest capture naming the course.
    try {
      const { data: meta } = await supabase
        .from('course_meta')
        .select('course_key, display_name')
        .eq('evergreen_code', code)
        .maybeSingle()
      if (meta) {
        const { data: openCls } = await supabase
          .from('classes')
          .select('slug, created_at')
          .eq('course_key', meta.course_key)
          .eq('status', 'open')
          .not('slug', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
        if (openCls?.[0]?.slug) redirect(`/c/${openCls[0].slug}?via=${encodeURIComponent(code)}`)
        const { data: lastCls } = await supabase
          .from('classes')
          .select('class_type, created_at')
          .eq('course_key', meta.course_key)
          .order('created_at', { ascending: false })
          .limit(1)
        const courseName =
          meta.display_name ??
          lastCls?.[0]?.class_type ??
          meta.course_key.split('-').map((w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
        capture = {
          schoolId: null,
          classType: lastCls?.[0]?.class_type ?? courseName,
          heading: `No upcoming ${courseName} class right now`,
          sub: "Leave your email and we'll let you know the moment the next one opens for registration — nothing else, no newsletter.",
        }
      }
    } catch (e) {
      if (isRedirectError(e)) throw e
    }
    if (capture) return renderCapture(capture)

    return honestCard(null)
  }

  // A known code counts, hit or idle — the count is the "does printed
  // collateral still get scanned?" signal (per code, per Denver day).
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  await supabase.rpc('bump_short_link_click', { p_code: code, p_day: day }).then(
    () => {},
    () => {} // counting must never block the redirect
  )

  const target = one<any>(row.classes)
  if (target?.slug) {
    redirect(`/c/${target.slug}?via=${encodeURIComponent(code)}`)
  }
  return honestCard(row.school_id ?? target?.school_id ?? null)
}
