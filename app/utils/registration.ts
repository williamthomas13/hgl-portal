import { supabaseAdmin as supabase } from './supabase-admin'

// Family/student attachment for registrations (PHASE4_SPEC §7): the form must
// match on parent email and attach new students/enrollments to the EXISTING
// family — "two siblings, same class" and "younger sibling, two years later"
// both land in one family. The old code upserted the family row, which also
// overwrote the parent's name on every repeat registration (that's how the QA
// family's name got clobbered) — now the name is only written on first
// contact. Students are matched within the family by name (or student email)
// so a returning student's second class reuses their row.

export type RegistrantInput = {
  parentFirst: string
  parentLast: string
  parentEmail: string // already trimmed + lowercased
  studentFirst: string
  studentLast: string
  studentEmail: string | null
  schoolId: string | null
  graduatingYear: string | null
}

export async function upsertFamilyAndStudent(
  input: RegistrantInput
): Promise<{ familyId: string; studentId: string } | { error: string }> {
  // 1. Family: match on parent_email; create only if missing.
  const { data: existingFamily } = await supabase
    .from('families')
    .select('id')
    .ilike('parent_email', input.parentEmail)
    .limit(1)
    .maybeSingle()

  let familyId = existingFamily?.id as string | undefined
  if (!familyId) {
    const { data: created, error } = await supabase
      .from('families')
      .insert([
        {
          parent_first_name: input.parentFirst,
          parent_last_name: input.parentLast,
          parent_email: input.parentEmail,
        },
      ])
      .select('id')
      .single()
    if (error || !created) {
      // Unique-violation race (double submit): re-read instead of failing.
      const { data: raced } = await supabase
        .from('families')
        .select('id')
        .ilike('parent_email', input.parentEmail)
        .limit(1)
        .maybeSingle()
      if (!raced) return { error: 'Error saving account: ' + (error?.message ?? 'unknown') }
      familyId = raced.id
    } else {
      familyId = created.id
    }
  }
  if (!familyId) return { error: 'Could not resolve family record.' }

  // 2. Student: reuse the family's existing row for the same kid (matched by
  // student email, else by name); otherwise create a sibling.
  const { data: familyStudents } = await supabase
    .from('students')
    .select('id, first_name, last_name, student_email, school_id, graduating_year')
    .eq('family_id', familyId)

  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const match = (familyStudents ?? []).find(
    (s) =>
      (input.studentEmail && norm(s.student_email) === norm(input.studentEmail)) ||
      (norm(s.first_name) === norm(input.studentFirst) &&
        norm(s.last_name) === norm(input.studentLast))
  )

  if (match) {
    // Fill in anything we learned this time without erasing what we had.
    const updates: Record<string, string> = {}
    if (input.studentEmail && !match.student_email) updates.student_email = input.studentEmail
    if (input.schoolId && !match.school_id) updates.school_id = input.schoolId
    if (input.graduatingYear && !match.graduating_year)
      updates.graduating_year = input.graduatingYear
    if (Object.keys(updates).length > 0) {
      await supabase.from('students').update(updates).eq('id', match.id)
    }
    return { familyId, studentId: match.id }
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .insert([
      {
        family_id: familyId,
        first_name: input.studentFirst,
        last_name: input.studentLast,
        student_email: input.studentEmail,
        school_id: input.schoolId,
        graduating_year: input.graduatingYear,
      },
    ])
    .select('id')
    .single()
  if (studentError || !student) {
    return { error: 'Error saving student: ' + (studentError?.message ?? 'unknown') }
  }
  return { familyId, studentId: student.id }
}
