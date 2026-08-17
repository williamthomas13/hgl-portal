import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

// PL-348: the shared class-page content blocks (Settings → Class pages).
// GET lists every block; POST updates one by key. Keys are FIXED by the
// seed migration — this surface edits copy, it doesn't invent new page
// sections (the page template decides what renders where).

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const { data, error } = await supabase
    .from('site_content_blocks')
    .select('key, section, heading, body_markdown, sort_order, image, image_online, scope, course_key, class_id, updated_at, updated_by, reviewed_by, reviewed_at')
    .order('section')
    .order('sort_order')
  if (error) {
    return NextResponse.json(
      { error: 'The content blocks table is not set up yet — apply the PL-348 migration first.' },
      { status: 503 }
    )
  }

  // PL-367: resolve each group's preview target — a REAL /c page of a class
  // using that block set (the preview IS the real renderer). Newest open
  // class wins; a set with no class gets the clearly-labeled synthetic
  // sample page (/c/sample--{course-key} renders the same component).
  const { data: classRows } = await supabase
    .from('classes')
    .select('slug, class_type, status, course_key, school_id, created_at')
    .not('slug', 'is', null)
    .order('created_at', { ascending: false })
  const classes = (classRows ?? []) as {
    slug: string
    class_type: string | null
    status: string | null
    course_key: string | null
    school_id: string | null
  }[]
  const usable = classes.filter((c) => c.status !== 'cancelled')
  const pickFor = (courseKey: string) =>
    usable.find((c) => c.course_key === courseKey && c.status === 'open') ??
    usable.find((c) => c.course_key === courseKey) ??
    null
  const courseKeys = [
    ...new Set((data ?? []).filter((b) => b.scope === 'course').map((b) => b.course_key ?? '')),
  ].filter(Boolean)
  // PL-376 A: course_meta.display_name wins ("HGL ACT Prep"), then the
  // newest class's type, then the prettified key.
  const { data: metaRows } = await supabase
    .from('course_meta')
    .select('course_key, display_name')
    .in('course_key', courseKeys.length ? courseKeys : ['-'])
  const metaName = new Map(((metaRows as any[]) ?? []).map((m) => [m.course_key, m.display_name]))
  const coursePreviews: Record<string, { displayName: string; url: string; sample: boolean }> = {}
  for (const ck of courseKeys) {
    const named = classes.find((c) => c.course_key === ck && c.class_type)
    const displayName =
      (metaName.get(ck) as string | undefined) ??
      named?.class_type ??
      ck.split('-').map((w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
    const cls = pickFor(ck)
    coursePreviews[ck] = {
      displayName,
      url: cls ? `/c/${cls.slug}` : `/c/sample--${ck}`,
      sample: !cls,
    }
  }
  const sharedClass =
    usable.find((c) => c.school_id != null && c.status === 'open') ??
    usable.find((c) => c.status === 'open') ??
    null
  const flowClass = usable.find((c) => c.status === 'open') ?? null
  return NextResponse.json({
    blocks: data ?? [],
    preview: {
      shared: sharedClass
        ? { url: `/c/${sharedClass.slug}`, sample: false }
        : { url: '/c/sample--shared', sample: true },
      courses: coursePreviews,
      flow: flowClass ? { url: `/register/${flowClass.slug}` } : null,
    },
  })
}

const COURSE_KEY_RE = /^[a-z0-9-]{2,64}$/

/** PL-355: "mint a course block set" — a first-class admin action. Copies
 *  an existing course's blocks under the new key, or creates a starter set;
 *  refuses to touch a course that already has blocks. */
async function mintCourseSet(caller: { email: string }, courseKey: string, copyFrom: string | null) {
  const { data: existing } = await supabase
    .from('site_content_blocks')
    .select('key')
    .eq('scope', 'course')
    .eq('course_key', courseKey)
    .limit(1)
  if ((existing ?? []).length > 0) {
    return NextResponse.json(
      { error: `The course '${courseKey}' already has a block set — edit it below instead.` },
      { status: 409 }
    )
  }
  const stamp = { updated_at: new Date().toISOString(), updated_by: caller.email.toLowerCase() }
  let rows: Record<string, unknown>[]
  if (copyFrom) {
    const { data: source } = await supabase
      .from('site_content_blocks')
      .select('key, heading, body_markdown, sort_order')
      .eq('scope', 'course')
      .eq('course_key', copyFrom)
    if (!source || source.length === 0) {
      return NextResponse.json({ error: `No blocks found for '${copyFrom}' to copy.` }, { status: 404 })
    }
    rows = source.map((b) => ({
      key: b.key.replace(`course:${copyFrom}:`, `course:${courseKey}:`),
      section: 'course',
      heading: b.heading,
      body_markdown: b.body_markdown,
      sort_order: b.sort_order,
      scope: 'course',
      course_key: courseKey,
      ...stamp,
    }))
  } else {
    rows = [
      { suffix: 'hero-blurb', heading: '', body: '', sort: 0 },
      { suffix: 'built-around', heading: 'What this course covers', body: '', sort: 1 },
      { suffix: 'topics', heading: 'Sample of Topics Covered', body: '', sort: 2 },
      { suffix: 'practice-tests', heading: 'Practice tests', body: '', sort: 3 },
    ].map((t) => ({
      key: `course:${courseKey}:${t.suffix}`,
      section: 'course',
      heading: t.heading,
      body_markdown: t.body,
      sort_order: t.sort,
      scope: 'course',
      course_key: courseKey,
      ...stamp,
    }))
  }
  const { error } = await supabase.from('site_content_blocks').insert(rows)
  if (error) return NextResponse.json({ error: 'Minting failed: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true, minted: rows.length })
}

export async function POST(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  // PL-377: approving copy as-is is a REVIEW, not an edit — it stamps
  // reviewed_by/reviewed_at and leaves updated_by honest. Accepts one key
  // or a list (the per-group "mark all reviewed").
  if (body?.action === 'mark_reviewed') {
    const keys: string[] = Array.isArray(body.keys)
      ? body.keys.filter((k: unknown) => typeof k === 'string')
      : typeof body.key === 'string'
        ? [body.key]
        : []
    if (keys.length === 0) return NextResponse.json({ error: 'Nothing to mark.' }, { status: 400 })
    const { error } = await supabase
      .from('site_content_blocks')
      .update({ reviewed_by: caller.email.toLowerCase(), reviewed_at: new Date().toISOString() })
      .in('key', keys)
      .is('reviewed_by', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (body?.action === 'mint') {
    const courseKey = typeof body?.courseKey === 'string' ? body.courseKey.toLowerCase().trim() : ''
    if (!COURSE_KEY_RE.test(courseKey)) {
      return NextResponse.json(
        { error: 'Course keys are 2–64 characters: lowercase letters, numbers, and dashes (the wizard derives them from the class type — e.g. "act-prep").' },
        { status: 400 }
      )
    }
    const copyFrom = typeof body?.copyFrom === 'string' && body.copyFrom ? body.copyFrom : null
    return mintCourseSet(caller, courseKey, copyFrom)
  }
  const key = typeof body?.key === 'string' ? body.key : ''
  const heading = typeof body?.heading === 'string' ? body.heading : null
  const markdown = typeof body?.body_markdown === 'string' ? body.body_markdown : null
  if (!key || (heading == null && markdown == null)) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
  }
  const { data: existing } = await supabase
    .from('site_content_blocks')
    .select('key')
    .eq('key', key)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'Unknown content block.' }, { status: 404 })
  }
  const { error } = await supabase
    .from('site_content_blocks')
    .update({
      ...(heading != null ? { heading } : {}),
      ...(markdown != null ? { body_markdown: markdown } : {}),
      updated_at: new Date().toISOString(),
      updated_by: caller.email.toLowerCase(),
    })
    .eq('key', key)
  if (error) return NextResponse.json({ error: 'Saving failed: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
