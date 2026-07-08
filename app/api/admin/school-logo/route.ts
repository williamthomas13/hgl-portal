import { createSupabaseServerClient } from '../../../utils/supabase-server'
import { supabaseAdmin } from '../../../utils/supabase-admin'
import { adminAllowlist } from '../../../utils/portal-auth'
import { processLogo } from '../../../utils/logo-process'

// School logo upload (July 8 refinements §2): the browser posts the raw file
// here instead of straight to storage, so every stored crest has its white
// background flood-filled to transparency and its borders trimmed BEFORE it
// can render as a box on the flyer. Staff only; the service role writes to
// the public school-assets bucket.

export const maxDuration = 30

async function isStaff(email: string): Promise<boolean> {
  const lower = email.trim().toLowerCase()
  if (adminAllowlist().includes(lower)) return true
  const { data } = await supabaseAdmin.from('profiles').select('role').ilike('email', lower).limit(1)
  const role = data?.[0]?.role
  return role === 'admin' || role === 'manager'
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return new Response('Sign in required', { status: 401 })
  if (!(await isStaff(user.email))) return new Response('Staff only', { status: 403 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return new Response('Expected multipart form data', { status: 400 })
  }
  const schoolId = String(form.get('schoolId') ?? '')
  const file = form.get('file')
  if (!schoolId || !(file instanceof File)) {
    return new Response('schoolId and file are required', { status: 400 })
  }
  if (file.size > 8 * 1024 * 1024) {
    return new Response('Logo must be under 8MB', { status: 413 })
  }
  const { data: school } = await supabaseAdmin
    .from('schools')
    .select('id')
    .eq('id', schoolId)
    .single()
  if (!school) return new Response('School not found', { status: 404 })

  let png: Buffer | null
  try {
    png = await processLogo(Buffer.from(await file.arrayBuffer()))
  } catch (e) {
    console.error(`school-logo processing failed for ${schoolId}:`, e)
    return new Response('Could not read that image — try a PNG or JPG export', { status: 422 })
  }
  if (!png) {
    return new Response('That image came out empty after background removal', { status: 422 })
  }

  // Timestamped name: the public URL changes on re-upload, so cached
  // collateral can never show a stale crest.
  const path = `${schoolId}/logo-${Date.now()}.png`
  const { error: upErr } = await supabaseAdmin.storage
    .from('school-assets')
    .upload(path, png, { contentType: 'image/png', cacheControl: '3600', upsert: true })
  if (upErr) {
    console.error(`school-logo upload failed for ${schoolId}:`, upErr.message)
    return new Response('Storage upload failed: ' + upErr.message, { status: 502 })
  }
  const { data: pub } = supabaseAdmin.storage.from('school-assets').getPublicUrl(path)
  const { error: updErr } = await supabaseAdmin
    .from('schools')
    .update({ logo_url: pub.publicUrl })
    .eq('id', schoolId)
  if (updErr) {
    return new Response('Uploaded but could not save the URL: ' + updErr.message, { status: 502 })
  }
  return Response.json({ url: pub.publicUrl })
}
