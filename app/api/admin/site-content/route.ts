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
    .select('key, section, heading, body_markdown, sort_order, image, scope, course_key, class_id, updated_at, updated_by')
    .order('section')
    .order('sort_order')
  if (error) {
    return NextResponse.json(
      { error: 'The content blocks table is not set up yet — apply the PL-348 migration first.' },
      { status: 503 }
    )
  }
  return NextResponse.json({ blocks: data ?? [] })
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
