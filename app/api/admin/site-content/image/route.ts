import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { sessionRole } from '../../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { CLASS_PAGE_BUCKET, parseClassPageImage, type ClassPageImage } from '../../../../utils/class-page-images'

// PL-351: image upload/replace/remove for the class-page content blocks and
// the per-class hero photo. POST (multipart) uploads + attaches; PATCH
// (json) edits alt/layout without re-uploading; DELETE (json) detaches and
// removes the files. Variants (480/960/1600w webp) are generated HERE at
// upload time so the public page can serve a real srcset. Alt text is
// REQUIRED on every path — an image nobody can hear is half an image.

export const maxDuration = 30

const VARIANT_WIDTHS = [480, 960, 1600]
const LAYOUTS = ['left', 'right', 'hero'] as const

type Target =
  | { table: 'site_content_blocks'; column: 'image'; match: { key: string } }
  | { table: 'classes'; column: 'hero_image'; match: { id: string } }
  | { table: 'instructors'; column: 'headshot'; match: { id: string } }

function resolveTarget(target: unknown, key: unknown, classId: unknown): Target | null {
  if (target === 'block' && typeof key === 'string' && key) {
    return { table: 'site_content_blocks', column: 'image', match: { key } }
  }
  if (target === 'class-hero' && typeof classId === 'string' && classId) {
    return { table: 'classes', column: 'hero_image', match: { id: classId } }
  }
  // PL-358: instructor headshots (classId carries the instructor id — the
  // form field is named for the common case, the target disambiguates).
  if (target === 'instructor-headshot' && typeof classId === 'string' && classId) {
    return { table: 'instructors', column: 'headshot', match: { id: classId } }
  }
  return null
}

async function loadExisting(t: Target): Promise<{ found: boolean; image: ClassPageImage | null }> {
  const { data } = await supabase
    .from(t.table)
    .select(t.column)
    .match(t.match)
    .maybeSingle()
  if (!data) return { found: false, image: null }
  return { found: true, image: parseClassPageImage((data as Record<string, unknown>)[t.column]) }
}

async function removeFiles(image: ClassPageImage | null) {
  if (!image) return
  const paths = [...new Set([image.path, ...(image.variants ?? []).map((v) => v.path)])]
  if (paths.length) await supabase.storage.from(CLASS_PAGE_BUCKET).remove(paths).catch(() => {})
}

export async function POST(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 })
  }
  const t = resolveTarget(form.get('target'), form.get('key'), form.get('classId'))
  const file = form.get('file')
  const alt = String(form.get('alt') ?? '').trim()
  const layoutRaw = String(form.get('layout') ?? '')
  const layout = (LAYOUTS as readonly string[]).includes(layoutRaw) ? (layoutRaw as ClassPageImage['layout']) : undefined
  if (!t) return NextResponse.json({ error: 'Unknown image target.' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'A file is required.' }, { status: 400 })
  if (!alt) return NextResponse.json({ error: 'Alt text is required — describe the image for screen readers.' }, { status: 400 })
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: 'Images must be under 12MB.' }, { status: 413 })

  const existing = await loadExisting(t)
  if (!existing.found) return NextResponse.json({ error: 'That block/class no longer exists.' }, { status: 404 })

  let buffer: Buffer
  let srcWidth: number
  try {
    buffer = Buffer.from(await file.arrayBuffer())
    const meta = await sharp(buffer).metadata()
    if (!meta.width || !meta.height) throw new Error('no dimensions')
    srcWidth = meta.width
  } catch {
    return NextResponse.json({ error: 'Could not read that image — try a JPG, PNG, or WebP export.' }, { status: 422 })
  }

  // Generate webp renditions (never upscaled), largest last. Timestamped
  // paths so cached pages can never show a stale image after a replace.
  const prefix =
    t.table === 'site_content_blocks'
      ? `blocks/${(t.match as { key: string }).key}/${Date.now()}`
      : t.table === 'instructors'
        ? `team/${(t.match as { id: string }).id}/${Date.now()}`
        : `class-hero/${(t.match as { id: string }).id}/${Date.now()}`
  const widths = [...new Set(VARIANT_WIDTHS.map((w) => Math.min(w, srcWidth)))].sort((a, b) => a - b)
  const variants: { path: string; width: number; height: number }[] = []
  for (const w of widths) {
    const { data, info } = await sharp(buffer)
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true })
    const path = `${prefix}-${info.width}w.webp`
    const { error } = await supabase.storage
      .from(CLASS_PAGE_BUCKET)
      .upload(path, data, { contentType: 'image/webp', cacheControl: '31536000', upsert: true })
    if (error) return NextResponse.json({ error: 'Storage upload failed: ' + error.message }, { status: 502 })
    variants.push({ path, width: info.width, height: info.height })
  }
  const largest = variants[variants.length - 1]
  const descriptor: ClassPageImage = {
    path: largest.path,
    alt,
    ...(t.table === 'site_content_blocks' ? { layout: layout ?? 'right' } : {}),
    width: largest.width,
    height: largest.height,
    variants: variants.map((v) => ({ path: v.path, width: v.width })),
  }
  const { error: updErr } = await supabase.from(t.table).update({ [t.column]: descriptor }).match(t.match)
  if (updErr) return NextResponse.json({ error: 'Uploaded but could not attach: ' + updErr.message }, { status: 502 })
  await removeFiles(existing.image) // the replaced files, after the swap
  return NextResponse.json({ ok: true, image: descriptor })
}

export async function PATCH(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const t = resolveTarget(body?.target, body?.key, body?.classId)
  if (!t) return NextResponse.json({ error: 'Unknown image target.' }, { status: 400 })
  const existing = await loadExisting(t)
  if (!existing.found || !existing.image) {
    return NextResponse.json({ error: 'No image to edit here.' }, { status: 404 })
  }
  const alt = typeof body?.alt === 'string' ? body.alt.trim() : existing.image.alt
  if (!alt) return NextResponse.json({ error: 'Alt text is required — describe the image for screen readers.' }, { status: 400 })
  const layout = (LAYOUTS as readonly string[]).includes(body?.layout) ? body.layout : existing.image.layout
  const next = { ...existing.image, alt, ...(t.table === 'site_content_blocks' ? { layout } : {}) }
  const { error } = await supabase.from(t.table).update({ [t.column]: next }).match(t.match)
  if (error) return NextResponse.json({ error: 'Saving failed: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true, image: next })
}

export async function DELETE(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const t = resolveTarget(body?.target, body?.key, body?.classId)
  if (!t) return NextResponse.json({ error: 'Unknown image target.' }, { status: 400 })
  const existing = await loadExisting(t)
  if (!existing.found) return NextResponse.json({ error: 'That block/class no longer exists.' }, { status: 404 })
  const { error } = await supabase.from(t.table).update({ [t.column]: null }).match(t.match)
  if (error) return NextResponse.json({ error: 'Removing failed: ' + error.message }, { status: 500 })
  await removeFiles(existing.image)
  return NextResponse.json({ ok: true })
}
