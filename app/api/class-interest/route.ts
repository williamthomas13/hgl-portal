import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'

// PL-54b: public "tell me when the next one opens" capture — the closed /
// full / cancelled registration states. One email + optional student name;
// pure demand capture, no account, no payment. Re-submitting the same email
// just reconfirms (upsert dedupes on email × school × class_type).

const str = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Honeypot: bots fill the invisible field; humans never do.
  if (str(body.company)) return NextResponse.json({ ok: true })

  // PL-378: the evergreen-link capture — no class row exists (that's the
  // point), so school/classType arrive directly; source marks the door.
  if (body.evergreen === true) {
    const email = str(body.email)?.toLowerCase() ?? null
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }
    const classType = str(body.classType, 100)
    if (!classType) return NextResponse.json({ error: 'Missing class type.' }, { status: 400 })
    const schoolId = str(body.schoolId, 100)
    const { error } = await supabase.from('class_interest').upsert(
      {
        email,
        student_name: str(body.studentName, 200),
        school_id: schoolId || null,
        class_type: classType,
        source: 'evergreen-link',
      },
      { onConflict: 'email,school_id,class_type', ignoreDuplicates: false }
    )
    if (error && error.code !== '23505') {
      // Upsert can still conflict-fail when school_id is null (nulls never
      // match a unique constraint) — a duplicate row is harmless there.
      const { error: insErr } = await supabase.from('class_interest').insert([
        {
          email,
          student_name: str(body.studentName, 200),
          school_id: schoolId || null,
          class_type: classType,
          source: 'evergreen-link',
        },
      ])
      if (insErr) return NextResponse.json({ error: 'That did not save — try again?' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  const classId = str(body.classId, 100)
  const email = str(body.email)?.toLowerCase() ?? null
  const studentName = str(body.studentName)
  if (!classId || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  // school + class_type come from the class row, never the client.
  const { data: cls } = await supabase
    .from('classes')
    .select('id, school_id, class_type')
    .or(`id.eq.${classId},slug.eq.${classId}`)
    .maybeSingle()
  if (!cls?.school_id) {
    return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  }

  const { error } = await supabase.from('class_interest').upsert(
    [
      {
        email,
        student_name: studentName,
        school_id: cls.school_id,
        class_type: cls.class_type,
        source: 'public_form',
      },
    ],
    { onConflict: 'email,school_id,class_type', ignoreDuplicates: true }
  )
  if (error) {
    console.error('class-interest insert failed:', error.message)
    return NextResponse.json({ error: 'Something went wrong — please try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
