import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { tutoringConflictsForClass } from '../../../utils/instructor-conflicts'
import { classDisplayLabel } from '../../../utils/class-label'

// PL-434: the resolution surface's data — the SAME conflict computation the
// assign route returned at assignment time, recomputed from reality so the
// list (and the Needs Attention row that links here) self-clears as sessions
// are moved, cancelled, or the class schedule changes.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const classId = new URL(req.url).searchParams.get('classId')
  if (!classId) return NextResponse.json({ error: 'Pass classId.' }, { status: 400 })

  const { data: cls } = await supabase
    .from('classes')
    .select('id, class_type, delivery_mode, fo_short_name, instructor_id, schools ( nickname ), instructors ( name, email )')
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return NextResponse.json({ error: 'Unknown class.' }, { status: 404 })
  const classLabel = classDisplayLabel({
    schoolNickname: one<any>((cls as any).schools)?.nickname ?? null,
    deliveryMode: (cls as any).delivery_mode,
    shortName: (cls as any).fo_short_name,
    classType: (cls as any).class_type,
  })
  const inst = one<any>((cls as any).instructors)
  if (!(cls as any).instructor_id) {
    return NextResponse.json({ classLabel, instructorName: null, conflicts: [] })
  }
  const conflicts = await tutoringConflictsForClass(classId, (cls as any).instructor_id)
  return NextResponse.json({ classLabel, instructorName: inst?.name ?? inst?.email ?? 'The instructor', conflicts })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
