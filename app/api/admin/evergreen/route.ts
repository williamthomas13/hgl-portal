import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

// PL-378 (+amendment): evergreen link codes (per school + per course) and
// the hgl.co legacy-forward map. ONE collision validator across every
// namespace that answers on hgl.co paths — reserved app routes, class
// shortcodes, school codes, course codes, legacy forwards — with a
// plain-English reason for each refusal ("/act already forwards to…").

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
  const [{ data: sl }, { data: sch }, { data: cm }, { data: lr }] = await Promise.all([
    supabase.from('short_links').select('code, classes ( class_type )').eq('code', code).maybeSingle(),
    supabase.from('schools').select('id, name, nickname').eq('evergreen_code', code).maybeSingle(),
    supabase.from('course_meta').select('course_key, display_name').eq('evergreen_code', code).maybeSingle(),
    supabase.from('legacy_redirects').select('code, destination').eq('code', code).maybeSingle(),
  ])
  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (sl) {
    const ct = (Array.isArray((sl as any).classes) ? (sl as any).classes[0] : (sl as any).classes)?.class_type
    return `"/${code}" is already a class shortcode${ct ? ` (${ct})` : ''} — class shortcodes stay as-is for point-in-time shares`
  }
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
  const [{ data: schools }, { data: courses }, { data: legacy }] = await Promise.all([
    supabase.from('schools').select('id, name, nickname, evergreen_code').order('name'),
    supabase.from('course_meta').select('course_key, display_name, evergreen_code').order('course_key'),
    supabase.from('legacy_redirects').select('code, destination, note, updated_at').order('code'),
  ])
  return NextResponse.json({ schools: schools ?? [], courses: courses ?? [], legacy: legacy ?? [] })
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
