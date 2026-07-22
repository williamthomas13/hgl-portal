import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { createSupabaseServerClient } from '../../../utils/supabase-server'
import { renderSendRow } from '../../../utils/comms-render'

// PL-77: read-only render of a family-facing email for the instructor's
// comms timeline — "exactly what families saw/will see". Access: the
// signed-in user must be the assigned instructor of the send's class (staff
// profiles pass too). Best-effort for sent history (A3 rule: re-render with
// current data); event-driven templates that can't re-render outside the
// pipeline return subject-only.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export async function GET(req: Request) {
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  const { data: row } = await supabase
    .from('email_sends')
    .select('id, dedupe_key, template_key, enrollment_id, class_id, subject_rendered, status')
    .eq('id', id)
    .maybeSingle()
  if (!row?.class_id) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  // Authorization: assigned instructor of this class, or staff.
  const { data: cls } = await supabase
    .from('classes')
    .select('id, instructors ( email )')
    .eq('id', row.class_id)
    .maybeSingle()
  const instructorEmail = one<any>(cls?.instructors)?.email?.toLowerCase()
  let allowed = instructorEmail === user.email.toLowerCase()
  if (!allowed) {
    const { data: profile } = await session.from('profiles').select('role').eq('id', user.id).maybeSingle()
    allowed = profile?.role === 'admin' || profile?.role === 'manager'
  }
  if (!allowed) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const rendered = await renderSendRow(row)
  if (!rendered) {
    return NextResponse.json({
      subject: row.subject_rendered ?? row.template_key,
      html: null,
      note: 'This email was composed at send time and cannot be re-rendered — the subject above is what families received.',
    })
  }
  return NextResponse.json({ subject: rendered.subject, html: rendered.html })
}
