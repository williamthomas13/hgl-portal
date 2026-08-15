import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

// PL-349: the shortlink admin surface's API (Classes → Short links).
// GET lists every code with its target, last-changed, and click counts;
// POST handles create / repoint / retire (the UI confirms inline — the
// server just validates and stamps who/when).

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const CODE_RE = /^[a-z0-9-]{1,32}$/

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const [linksRes, clicksRes, classesRes] = await Promise.all([
    supabase
      .from('short_links')
      .select(
        'code, class_id, school_id, updated_at, updated_by, created_at, classes ( id, slug, class_type, status, start_date, school_id, short_link, schools ( nickname ) ), schools ( nickname )'
      )
      .order('code'),
    supabase.from('short_link_clicks').select('code, day, clicks'),
    supabase
      .from('classes')
      .select('id, slug, class_type, status, start_date, school_id, schools ( nickname ), sessions ( session_date )')
      .neq('status', 'cancelled'),
  ])
  if (linksRes.error) {
    return NextResponse.json(
      { error: 'The short-links tables are not set up yet — apply the PL-349 migration first.' },
      { status: 503 }
    )
  }

  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  const cutoff14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
  const clicksByCode = new Map<string, { total: number; last14: number }>()
  for (const c of ((clicksRes.data as any[]) ?? [])) {
    const entry = clicksByCode.get(c.code) ?? { total: 0, last14: 0 }
    entry.total += c.clicks
    if (String(c.day) >= cutoff14) entry.last14 += c.clicks
    clicksByCode.set(c.code, entry)
  }

  // Candidate classes for the repoint select: live (not cancelled, last day
  // not past), labeled the house way.
  const candidates = (((classesRes.data as any[]) ?? []))
    .filter((c) => {
      const days = (c.sessions ?? []).map((s: any) => s.session_date).sort()
      const lastDay = days.at(-1) ?? c.start_date
      return lastDay >= todayIso
    })
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      schoolId: c.school_id,
      label: `${one<any>(c.schools)?.nickname ?? ''} ${c.class_type}`.trim(),
      startDate: c.start_date,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const links = (((linksRes.data as any[]) ?? [])).map((l) => {
    const target = one<any>(l.classes)
    return {
      code: l.code,
      classId: l.class_id,
      schoolId: l.school_id ?? target?.school_id ?? null,
      schoolNickname: one<any>(l.schools)?.nickname ?? one<any>(target?.schools)?.nickname ?? null,
      target: target
        ? {
            id: target.id,
            slug: target.slug,
            label: `${one<any>(target.schools)?.nickname ?? ''} ${target.class_type}`.trim(),
            status: target.status,
            startDate: target.start_date,
          }
        : null,
      updatedAt: l.updated_at,
      updatedBy: l.updated_by,
      clicks: clicksByCode.get(l.code) ?? { total: 0, last14: 0 },
    }
  })

  return NextResponse.json({ links, candidates })
}

export async function POST(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const action = body?.action
  const code = typeof body?.code === 'string' ? body.code.toLowerCase().trim() : ''
  if (!CODE_RE.test(code)) {
    return NextResponse.json(
      { error: 'Short codes are 1–32 characters: lowercase letters, numbers, and dashes.' },
      { status: 400 }
    )
  }
  const stamp = { updated_at: new Date().toISOString(), updated_by: caller.email.toLowerCase() }

  if (action === 'retire') {
    const { error } = await supabase.from('short_links').delete().eq('code', code)
    if (error) return NextResponse.json({ error: 'Retiring failed: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action !== 'create' && action !== 'repoint') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
  const classId = typeof body?.classId === 'string' ? body.classId : ''
  if (!classId) return NextResponse.json({ error: 'Pick a class first.' }, { status: 400 })
  const { data: cls } = await supabase
    .from('classes')
    .select('id, school_id, short_link, status')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return NextResponse.json({ error: 'That class no longer exists.' }, { status: 404 })

  if (action === 'create') {
    const { error } = await supabase
      .from('short_links')
      .insert([{ code, class_id: cls.id, school_id: cls.school_id, ...stamp }])
    if (error) {
      const msg = error.code === '23505' ? `hgl.co/${code} already exists — repoint it instead.` : error.message
      return NextResponse.json({ error: msg }, { status: error.code === '23505' ? 409 : 500 })
    }
  } else {
    const { error } = await supabase
      .from('short_links')
      .update({ class_id: cls.id, school_id: cls.school_id ?? undefined, ...stamp })
      .eq('code', code)
    if (error) return NextResponse.json({ error: 'Repointing failed: ' + error.message }, { status: 500 })
  }

  // Keep the class's printed-collateral text in step when it has none yet —
  // the code IS its short link now. Never overwrite an existing value.
  if (!cls.short_link) {
    await supabase.from('classes').update({ short_link: `hgl.co/${code}` }).eq('id', cls.id)
  }
  return NextResponse.json({ ok: true })
}
