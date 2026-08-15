import { redirect } from 'next/navigation'
import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import { ClassStateCard } from '../components/ClassStateCard'

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

  if (!row) return honestCard(null)

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
