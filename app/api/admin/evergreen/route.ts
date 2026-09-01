import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

// PL-378 → PL-384: THE link registry — one evergreen code per school/course
// (the class-shortcode layer folded in; codes serve pages in place) plus the
// hgl.co legacy-forward map, with the pin escape hatch for the
// two-open-classes case. ONE collision validator across every namespace that
// answers on hgl.co paths — reserved app routes, school codes, course codes,
// legacy forwards — with a plain-English reason for each refusal.

const CODE_RE = /^[a-z0-9-]{2,32}$/

// Root-level routes + static files the resolver can never shadow.
const RESERVED = new Set([
  'admin', 'api', 'c', 'classes', 'team', 'register', 'portal', 'tutoring',
  'agreements', 'survey', 'survey-qr', 'unsubscribe', 'waitlist', 'success',
  'inquire', 'link-help', 'auth', 'login', 'classroom-request', 'addons',
  'availability', 'convert', 'coverage', 'intake', 'refund', 'class-report',
  'class-roster', 'collateral', 'llms.txt', 'sitemap.xml', 'robots.txt',
  'favicon.ico', 'sample',
])

/** Every taken code across the namespaces, with a plain-English owner. */
async function codeOwner(code: string, ignore?: { kind: string; id: string }): Promise<string | null> {
  if (RESERVED.has(code)) return `"/${code}" is a reserved portal page`
  const [{ data: sch }, { data: cm }, { data: lr }] = await Promise.all([
    supabase.from('schools').select('id, name, nickname').eq('evergreen_code', code).maybeSingle(),
    supabase.from('course_meta').select('course_key, display_name').eq('evergreen_code', code).maybeSingle(),
    supabase.from('legacy_redirects').select('code, destination').eq('code', code).maybeSingle(),
  ])
  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (sch && !(ignore?.kind === 'school' && ignore.id === sch.id)) {
    return `"/${code}" is already ${sch.nickname ?? sch.name}'s evergreen school link`
  }
  if (cm && !(ignore?.kind === 'course' && ignore.id === cm.course_key)) {
    return `"/${code}" is already the evergreen link for ${cm.display_name ?? cm.course_key}`
  }
  if (lr && !(ignore?.kind === 'legacy' && ignore.id === lr.code)) {
    return `"/${code}" already forwards to ${lr.destination} (a legacy hgl.co forward — retire it first if you want the code)`
  }
  return null
}

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const [
    { data: schools },
    { data: courses },
    { data: legacy },
    { data: openClasses },
    { data: clicks },
    { data: courseClasses },
  ] = await Promise.all([
    supabase.from('schools').select('id, name, nickname, evergreen_code, evergreen_pin_class_id').order('name'),
    supabase
      .from('course_meta')
      .select('course_key, display_name, evergreen_code, evergreen_pin_class_id')
      .order('course_key'),
    supabase.from('legacy_redirects').select('code, destination, note, updated_at').order('code'),
    supabase
      .from('classes')
      .select('id, slug, class_type, status, school_id, course_key, created_at, start_date')
      .eq('status', 'open')
      .not('slug', 'is', null)
      .order('created_at', { ascending: false }),
    supabase.from('short_link_clicks').select('code, day, clicks'),
    // PL-447: EVERY course key that has (or has had) a no-school class —
    // any status, so a course whose only cohort finished still keeps its
    // row (like a school with no open class does). Newest first for the
    // display-name resolution.
    supabase
      .from('classes')
      .select('course_key, class_type, created_at')
      .is('school_id', null)
      .not('course_key', 'is', null)
      .order('created_at', { ascending: false }),
  ])

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // PL-384: what each code SERVES right now (pin wins while open, else
  // newest open, else the interest capture) + click history (the counter
  // carried straight over from the shortcode era — same codes, same table).
  const cutoff = new Date(Date.now() - 14 * 86400_000).toLocaleDateString('en-CA')
  const clicksFor = (code: string | null) => {
    if (!code) return { total: 0, last14: 0 }
    const rows = ((clicks as any[]) ?? []).filter((r) => r.code === code)
    return {
      total: rows.reduce((a, r) => a + Number(r.clicks), 0),
      last14: rows.filter((r) => r.day >= cutoff).reduce((a, r) => a + Number(r.clicks), 0),
    }
  }
  const open = (openClasses as any[]) ?? []
  const servingFor = (filter: (c: any) => boolean, pinId: string | null) => {
    const pinned = pinId ? open.find((c) => c.id === pinId) ?? null : null
    const auto = open.filter(filter)[0] ?? null
    const serving = pinned ?? auto
    return serving
      ? {
          classId: serving.id,
          // PL-436: two cohorts of the same type must read apart — the label
          // carries the start date ("SAT Prep (starts Oct 13)").
          label: `${serving.class_type} (starts ${new Date(serving.start_date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })})`,
          pinned: Boolean(pinned),
        }
      : null
  }
  return NextResponse.json({
    schools: ((schools as any[]) ?? []).map((sc) => ({
      ...sc,
      serving: sc.evergreen_code ? servingFor((c) => c.school_id === sc.id, sc.evergreen_pin_class_id) : null,
      candidates: open.filter((c) => c.school_id === sc.id).map((c) => ({ id: c.id, label: c.class_type })),
      clicks: clicksFor(sc.evergreen_code),
    })),
    // PL-447: the Course section derives from EVERY course key with a
    // no-school class (the schools-list pattern) — a course_meta row is NOT
    // required to appear; the code-save upsert mints it on first save, so a
    // brand-new course shows an empty code box with zero round-trips.
    // Display name = course_meta → newest class's type → prettified key
    // (the evergreen.ts resolution). Existing rows untouched.
    courses: (() => {
      const metaByKey = new Map(((courses as any[]) ?? []).map((cm) => [cm.course_key, cm]))
      const newestTypeByKey = new Map<string, string>()
      for (const c of (courseClasses as any[]) ?? []) {
        if (!newestTypeByKey.has(c.course_key)) newestTypeByKey.set(c.course_key, c.class_type)
      }
      const prettify = (key: string) =>
        key.split('-').map((w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
      const allKeys = [...new Set([...metaByKey.keys(), ...newestTypeByKey.keys()])].sort()
      return allKeys.map((key) => {
        const cm = metaByKey.get(key) ?? {
          course_key: key,
          display_name: null,
          evergreen_code: null,
          evergreen_pin_class_id: null,
        }
        return {
          ...cm,
          display_name: cm.display_name ?? newestTypeByKey.get(key) ?? prettify(key),
          serving: cm.evergreen_code
            ? servingFor((c) => !c.school_id && c.course_key === key, cm.evergreen_pin_class_id)
            : null,
          candidates: open
            .filter((c) => !c.school_id && c.course_key === key)
            .map((c) => ({ id: c.id, label: c.class_type })),
          clicks: clicksFor(cm.evergreen_code),
        }
      })
    })(),
    legacy: legacy ?? [],
  })
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  if (action === 'set_school_code' || action === 'set_course_code') {
    const id = typeof body?.id === 'string' ? body.id : ''
    const code = typeof body?.code === 'string' ? body.code.toLowerCase().trim() : ''
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
    if (code && !CODE_RE.test(code)) {
      return NextResponse.json(
        { error: 'Codes are 2–32 characters: lowercase letters, numbers, and dashes.' },
        { status: 400 }
      )
    }
    if (code) {
      const owner = await codeOwner(code, {
        kind: action === 'set_school_code' ? 'school' : 'course',
        id,
      })
      if (owner) return NextResponse.json({ error: owner }, { status: 409 })
    }
    const { error } =
      action === 'set_school_code'
        ? await supabase.from('schools').update({ evergreen_code: code || null }).eq('id', id)
        : await supabase
            .from('course_meta')
            .upsert({ course_key: id, evergreen_code: code || null, updated_at: new Date().toISOString() }, { onConflict: 'course_key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // PL-448: claiming a code takes precedence over the wildcard forward —
    // WARN (never block) when the same-named path is a live page on the main
    // site, i.e. plausibly a link someone has been sharing as hgl.co/{code}.
    let warning: string | null = null
    if (code) {
      try {
        const probe = await fetch(`https://highergroundlearning.com/${code}`, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(4000),
        })
        if (probe.ok) {
          warning = `Heads up: highergroundlearning.com/${code} is a live page on the main site — until now, hgl.co/${code} forwarded there via the wildcard. The code takes precedence, so anyone still sharing that old link will land on the class page instead. If that path was being shared on purpose, pick a different code or add a legacy forward.`
        }
      } catch {
        /* probe is best-effort — no warning beats a wrong one */
      }
    }
    return NextResponse.json({ ok: true, warning })
  }

  if (action === 'set_school_pin' || action === 'set_course_pin') {
    const id = typeof body?.id === 'string' ? body.id : ''
    const classId = typeof body?.classId === 'string' && body.classId ? body.classId : null
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
    if (classId) {
      const { data: cls } = await supabase.from('classes').select('id, status').eq('id', classId).maybeSingle()
      if (!cls) return NextResponse.json({ error: 'That class no longer exists.' }, { status: 400 })
      if (cls.status !== 'open') {
        return NextResponse.json(
          { error: 'Only an open class can be pinned — a closed pin would just fall back to auto anyway.' },
          { status: 400 }
        )
      }
    }
    const { error } =
      action === 'set_school_pin'
        ? await supabase.from('schools').update({ evergreen_pin_class_id: classId }).eq('id', id)
        : // PL-447: course rows may be VIRTUAL (derived from classes, no
          // course_meta row yet) — a pin on one mints the row, same as the
          // code-save upsert does.
          await supabase
            .from('course_meta')
            .upsert(
              { course_key: id, evergreen_pin_class_id: classId, updated_at: new Date().toISOString() },
              { onConflict: 'course_key' }
            )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_legacy') {
    const code = typeof body?.code === 'string' ? body.code.toLowerCase().trim() : ''
    const destination = typeof body?.destination === 'string' ? body.destination.trim() : ''
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ error: 'Codes are 2–32 characters: lowercase letters, numbers, and dashes.' }, { status: 400 })
    }
    if (!/^https?:\/\//.test(destination)) {
      return NextResponse.json({ error: 'The destination must be a full http(s) URL.' }, { status: 400 })
    }
    const owner = await codeOwner(code, { kind: 'legacy', id: code })
    if (owner) return NextResponse.json({ error: owner }, { status: 409 })
    const { error } = await supabase.from('legacy_redirects').upsert(
      { code, destination, note: typeof body?.note === 'string' ? body.note : null, updated_at: new Date().toISOString() },
      { onConflict: 'code' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_legacy') {
    const code = typeof body?.code === 'string' ? body.code : ''
    if (!code) return NextResponse.json({ error: 'Missing code.' }, { status: 400 })
    const { error } = await supabase.from('legacy_redirects').delete().eq('code', code)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
