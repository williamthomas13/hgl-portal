import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { createSupabaseServerClient } from '../../../utils/supabase-server'

// PL-203: family-facing materials — tutors/instructors attach files or links
// (+ an optional note) to a student; the family portal shows them. Writes
// land here (service role) behind a session check: the caller must be staff
// or an instructor actually connected to the student (tutoring sessions or a
// class they teach). Files live in the PRIVATE student-materials bucket and
// are only ever served through short-lived signed URLs minted after the same
// check — role-gating is structural, not cosmetic.

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  txt: 'text/plain',
}

type Caller =
  | { kind: 'staff'; email: string; name: string | null }
  | { kind: 'instructor'; email: string; name: string | null }
  | { kind: 'parent'; email: string; studentIds: string[] }

async function identifyCaller(): Promise<Caller | null> {
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) return null
  const email = user.email.toLowerCase()
  const { data: profile } = await session.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'admin' || profile?.role === 'manager') {
    const { data: inst } = await supabase.from('instructors').select('name').ilike('email', email).maybeSingle()
    return { kind: 'staff', email, name: inst?.name ?? null }
  }
  const { data: inst } = await supabase.from('instructors').select('name').ilike('email', email).maybeSingle()
  if (inst) return { kind: 'instructor', email, name: inst.name }
  const { data: fams } = await supabase.from('families').select('id').ilike('parent_email', email)
  if (fams?.length) {
    const { data: kids } = await supabase
      .from('students')
      .select('id')
      .in('family_id', fams.map((f) => f.id))
    return { kind: 'parent', email, studentIds: (kids ?? []).map((k) => k.id) }
  }
  return null
}

/** Is this instructor actually connected to the student? */
async function instructorTeaches(email: string, studentId: string): Promise<boolean> {
  const [{ data: viaTutoring }, { data: viaClass }] = await Promise.all([
    supabase
      .from('tutoring_sessions')
      .select('id, instructors!tutoring_sessions_tutor_id_fkey ( email )')
      .eq('student_id', studentId)
      .limit(200),
    supabase
      .from('enrollments')
      .select('id, classes ( instructors ( email ) )')
      .eq('student_id', studentId),
  ])
  const tutoringMatch = ((viaTutoring as any[]) ?? []).some((s) => {
    const i = Array.isArray(s.instructors) ? s.instructors[0] : s.instructors
    return i?.email?.toLowerCase() === email
  })
  if (tutoringMatch) return true
  return ((viaClass as any[]) ?? []).some((e) => {
    const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes
    const i = cls && (Array.isArray(cls.instructors) ? cls.instructors[0] : cls.instructors)
    return i?.email?.toLowerCase() === email
  })
}

/** PL-260: does this instructor teach this class? */
async function instructorOwnsClass(email: string, classId: string): Promise<boolean> {
  const { data } = await supabase
    .from('classes')
    .select('id, instructors ( email )')
    .eq('id', classId)
    .maybeSingle()
  const i = data && (Array.isArray(data.instructors) ? data.instructors[0] : data.instructors)
  return (i as any)?.email?.toLowerCase() === email
}

async function withSignedUrls(rows: any[]): Promise<any[]> {
  return Promise.all(
    rows.map(async (r) => {
      if (r.kind !== 'file' || !r.storage_path) return r
      const { data } = await supabase.storage.from('student-materials').createSignedUrl(r.storage_path, 3600)
      return { ...r, url: data?.signedUrl ?? null }
    })
  )
}

export async function GET(req: Request) {
  const caller = await identifyCaller()
  if (!caller) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const studentId = searchParams.get('studentId')
  const classId = searchParams.get('classId')

  let q = supabase
    .from('student_materials')
    .select('id, student_id, class_id, instructor_email, instructor_name, kind, title, url, storage_path, note, created_at')
    .order('created_at', { ascending: false })

  if (caller.kind === 'parent') {
    if (caller.studentIds.length === 0) return NextResponse.json({ materials: [] })
    // PL-260: families see their students' items AND anything shared with a
    // class those students are enrolled in.
    const sids = studentId ? [studentId].filter((s) => caller.studentIds.includes(s)) : caller.studentIds
    const { data: enr } = sids.length
      ? await supabase.from('enrollments').select('class_id').in('student_id', sids)
      : { data: [] }
    const classIds = [...new Set(((enr as any[]) ?? []).map((e) => e.class_id).filter(Boolean))]
    const parts: string[] = []
    if (sids.length) parts.push(`student_id.in.(${sids.join(',')})`)
    if (classIds.length) parts.push(`class_id.in.(${classIds.join(',')})`)
    if (parts.length === 0) return NextResponse.json({ materials: [] })
    q = q.or(parts.join(','))
  } else if (classId) {
    // PL-260: an instructor's class-wide materials list.
    if (caller.kind === 'instructor' && !(await instructorOwnsClass(caller.email, classId))) {
      return NextResponse.json({ error: 'Not your class.' }, { status: 403 })
    }
    q = q.eq('class_id', classId)
  } else if (studentId) {
    if (caller.kind === 'instructor' && !(await instructorTeaches(caller.email, studentId))) {
      return NextResponse.json({ error: 'Not your student.' }, { status: 403 })
    }
    q = q.eq('student_id', studentId)
  } else if (caller.kind === 'instructor') {
    return NextResponse.json({ error: 'studentId or classId required.' }, { status: 400 })
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ materials: await withSignedUrls(data ?? []) })
}

export async function POST(req: Request) {
  const caller = await identifyCaller()
  if (!caller || caller.kind === 'parent') {
    return NextResponse.json({ error: 'Only tutors and staff can share materials.' }, { status: 403 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const studentId = String(form.get('studentId') ?? '')
  // PL-260: class-wide share — exactly one target.
  const classId = String(form.get('classId') ?? '')
  const title = String(form.get('title') ?? '').trim()
  const note = String(form.get('note') ?? '').trim() || null
  const link = String(form.get('link') ?? '').trim()
  const file = form.get('file') as File | null

  if (!studentId && !classId) return NextResponse.json({ error: 'Missing student or class.' }, { status: 400 })
  if (studentId && classId) return NextResponse.json({ error: 'Share with a student OR a class, not both.' }, { status: 400 })
  if (classId) {
    if (caller.kind === 'instructor' && !(await instructorOwnsClass(caller.email, classId))) {
      return NextResponse.json({ error: 'Not your class.' }, { status: 403 })
    }
  } else if (caller.kind === 'instructor' && !(await instructorTeaches(caller.email, studentId))) {
    return NextResponse.json({ error: 'Not your student.' }, { status: 403 })
  }
  if (!link && !file) return NextResponse.json({ error: 'Attach a file or paste a link.' }, { status: 400 })

  let kind: 'file' | 'link' = 'link'
  let url: string | null = null
  let storagePath: string | null = null

  if (file) {
    kind = 'file'
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 10MB. A link works for anything bigger.` },
        { status: 400 }
      )
    }
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (!ALLOWED_EXT[ext]) {
      return NextResponse.json(
        { error: `.${ext || '?'} files aren't accepted — PDFs, Word docs, images, and .txt are (or share a link).` },
        { status: 400 }
      )
    }
    storagePath = `${classId ? `class/${classId}` : studentId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: upErr } = await supabase.storage
      .from('student-materials')
      .upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: ALLOWED_EXT[ext] })
    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
  } else {
    if (!/^https?:\/\//i.test(link)) {
      return NextResponse.json({ error: 'Links need to start with http:// or https://.' }, { status: 400 })
    }
    url = link
  }

  const { data, error } = await supabase
    .from('student_materials')
    .insert({
      student_id: studentId || null,
      class_id: classId || null,
      instructor_email: caller.email,
      instructor_name: caller.name,
      kind,
      title: title || (file ? file.name : link),
      url,
      storage_path: storagePath,
      note,
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: Request) {
  const caller = await identifyCaller()
  if (!caller || caller.kind === 'parent') {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
  const { data: row } = await supabase
    .from('student_materials')
    .select('id, instructor_email, storage_path')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Already gone.' }, { status: 404 })
  if (caller.kind === 'instructor' && row.instructor_email.toLowerCase() !== caller.email) {
    return NextResponse.json({ error: 'Only the sharer (or staff) can remove it.' }, { status: 403 })
  }
  if (row.storage_path) {
    await supabase.storage.from('student-materials').remove([row.storage_path]).catch(() => {})
  }
  await supabase.from('student_materials').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
