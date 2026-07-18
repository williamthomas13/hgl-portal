import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin as supabase } from './supabase-admin'
import type { AvailabilityRange } from './availability'

// Phase 7e intake & onboarding (docs/PHASE7_SPEC.md §11): signed-link tokens
// for the public intake form and the policy-agreement page (house HMAC
// pattern — CRON_SECRET HMAC, distinct prefix per purpose), plus the intake
// submission → family/student upsert that replaces scan-and-return forms.

// ---------------------------------------------------------------------------
// Signed links
// ---------------------------------------------------------------------------

function sig(prefix: string, id: string): string {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`${prefix}:${id}`)
    .digest('hex')
    .slice(0, 32)
}

function verify(prefix: string, token: string): string | null {
  const [id, given] = token.split('.')
  if (!id || !given) return null
  const expected = Buffer.from(sig(prefix, id))
  const got = Buffer.from(given)
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null
}

/** /intake/{token} — HMAC over the lead id. */
export function intakeToken(leadId: string): string {
  return `${leadId}.${sig('intake', leadId)}`
}

export function verifyIntakeToken(token: string): string | null {
  return verify('intake', token)
}

/** /agreements/{token} — HMAC over the family id (spec §12). */
export function agreementToken(familyId: string): string {
  return `${familyId}.${sig('agreement', familyId)}`
}

export function verifyAgreementToken(token: string): string | null {
  return verify('agreement', token)
}

/** /availability/{token} — HMAC over the family id (PL-53b: the add-on
 *  family's share-your-availability page; reusable and idempotent). */
export function availabilityToken(familyId: string): string {
  return `${familyId}.${sig('availability', familyId)}`
}

export function verifyAvailabilityToken(token: string): string | null {
  return verify('availability', token)
}

// ---------------------------------------------------------------------------
// Intake submission (spec §11): creates/updates family + student, DEDUPING by
// parent email — a family that came through a group class is matched, never
// duplicated, and skips re-entering what HGL already knows.
// ---------------------------------------------------------------------------

export type IntakeSubmission = {
  // Student
  studentFirst: string
  studentLast: string
  studentPhone: string | null
  studentEmail: string | null
  school: string | null
  grade: string | null
  // Guardian(s)
  guardianFirst: string
  guardianLast: string
  guardianPhone: string | null
  guardianEmail: string // trimmed + lowercased by the route
  guardian2Name: string | null
  guardian2Phone: string | null
  guardian2Email: string | null
  // Contact preferences
  preferredContactMethod: 'call' | 'text' | 'email' | null
  /** Who to reach if the student hasn't arrived, and how (call/text). */
  absentContactWho: 'student' | 'parent' | null
  absentContactHow: 'call' | 'text' | null
  // Emergency contact
  emergencyName: string | null
  emergencyPhone: string | null
  emergencyRelation: string | null
  // About
  howHeard: string | null
  reason: string | null
  specialNeeds: string | null
  // Focus
  interest: 'test_prep' | 'subject'
  testDate: string | null
  priorScores: string | null
  subjects: string | null
  // Logistics
  availabilityText: string | null
  onlinePreference: 'online' | 'in_person' | 'either' | null
  /** PL-19 structured weekly availability (validated by the route). */
  availability: AvailabilityRange[]
  /** Family's IANA timezone for the availability ranges. */
  availabilityTimezone: string
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * Apply a token-verified intake submission: find-or-create the family by
 * parent email (name written only on first contact — the registration.ts
 * rule), match-or-create the student inside it, store every answer on the
 * lead row, and flip the lead to intake_complete. Idempotent — a re-submit
 * updates the same records.
 */
export async function applyIntakeSubmission(
  leadId: string,
  sub: IntakeSubmission
): Promise<{ ok: true; familyId: string; studentId: string } | { ok: false; error: string }> {
  const { data: lead } = await supabase
    .from('leads')
    .select('id, status, family_id, student_id')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return { ok: false, error: 'Unknown lead.' }

  // 1. Family: match on parent email; create only if missing. Never overwrite
  // an existing family's parent name (that's how QA names got clobbered once).
  const { data: existingFamily } = await supabase
    .from('families')
    .select('id')
    .ilike('parent_email', sub.guardianEmail)
    .limit(1)
    .maybeSingle()

  let familyId = existingFamily?.id as string | undefined
  if (!familyId) {
    const { data: created, error } = await supabase
      .from('families')
      .insert([
        {
          parent_first_name: sub.guardianFirst,
          parent_last_name: sub.guardianLast,
          parent_email: sub.guardianEmail,
        },
      ])
      .select('id')
      .single()
    if (error || !created) {
      // Unique-violation race (double submit): re-read instead of failing.
      const { data: raced } = await supabase
        .from('families')
        .select('id')
        .ilike('parent_email', sub.guardianEmail)
        .limit(1)
        .maybeSingle()
      if (!raced) return { ok: false, error: 'Could not save your family record.' }
      familyId = raced.id
    } else {
      familyId = created.id
    }
  }
  if (!familyId) return { ok: false, error: 'Could not resolve family record.' }

  // 2. Student: reuse the family's existing row for the same kid (matched by
  // student email, else by name); otherwise create a sibling. Fill in what we
  // learned without erasing what we had.
  const { data: familyStudents } = await supabase
    .from('students')
    .select('id, first_name, last_name, student_email, grade_level')
    .eq('family_id', familyId)

  const match = (familyStudents ?? []).find(
    (s) =>
      (sub.studentEmail && norm(s.student_email) === norm(sub.studentEmail)) ||
      (norm(s.first_name) === norm(sub.studentFirst) && norm(s.last_name) === norm(sub.studentLast))
  )

  let studentId: string
  if (match) {
    const updates: Record<string, string> = {}
    if (sub.studentEmail && !match.student_email) updates.student_email = sub.studentEmail
    if (sub.grade && !match.grade_level) updates.grade_level = sub.grade
    // PL-36: newest family word wins for phone + needs (these change; the
    // family just told us the current truth).
    if (sub.studentPhone) updates.student_phone = sub.studentPhone
    if (sub.specialNeeds) updates.special_needs = sub.specialNeeds
    if (Object.keys(updates).length > 0) {
      await supabase.from('students').update(updates).eq('id', match.id)
    }
    studentId = match.id
  } else {
    const { data: student, error: studentError } = await supabase
      .from('students')
      .insert([
        {
          family_id: familyId,
          first_name: sub.studentFirst,
          last_name: sub.studentLast,
          student_email: sub.studentEmail,
          grade_level: sub.grade,
          student_phone: sub.studentPhone,
          special_needs: sub.specialNeeds,
        },
      ])
      .select('id')
      .single()
    if (studentError || !student) {
      return { ok: false, error: 'Could not save the student record.' }
    }
    studentId = student.id
  }

  // PL-36: the phone + second guardian land on the family record too (fill
  // phone only when blank — billing may have a curated value; guardian2 is
  // family-stated truth, so it refreshes).
  {
    const { data: fam } = await supabase
      .from('families')
      .select('parent_phone')
      .eq('id', familyId)
      .maybeSingle()
    const patch: Record<string, string | null> = {}
    if (sub.guardianPhone && !fam?.parent_phone) patch.parent_phone = sub.guardianPhone
    if (sub.guardian2Name) patch.guardian2_name = sub.guardian2Name
    if (sub.guardian2Phone) patch.guardian2_phone = sub.guardian2Phone
    if (sub.guardian2Email) patch.guardian2_email = sub.guardian2Email
    if (Object.keys(patch).length > 0) {
      const { error: famError } = await supabase.from('families').update(patch).eq('id', familyId)
      if (famError) console.error('intake family detail update failed (submission stands):', famError.message)
    }
  }

  // 2b. Availability grid (PL-19): replace this student's intake-sourced rows
  // wholesale — a re-submit is the family's newest word. Staff-entered rows
  // are left alone, and an empty grid just clears the intake ones (empty =
  // unknown, never "unavailable"). Failure here never sinks the submission.
  const { error: availabilityError } = await supabase
    .from('student_availability')
    .delete()
    .eq('student_id', studentId)
    .eq('source', 'intake')
  if (availabilityError) {
    console.error('intake availability clear failed (submission stands):', availabilityError.message)
  } else if (sub.availability.length > 0) {
    const { error: insertError } = await supabase.from('student_availability').insert(
      sub.availability.map((r) => ({
        student_id: studentId,
        weekday: r.weekday,
        start_time: r.start_time,
        end_time: r.end_time,
        timezone: sub.availabilityTimezone,
        source: 'intake',
      }))
    )
    if (insertError) {
      console.error('intake availability insert failed (submission stands):', insertError.message)
    }
  }

  // 3. Lead: every answer verbatim in `intake`, scalars refreshed for the
  // pipeline view, status → intake_complete.
  const { error: leadError } = await supabase
    .from('leads')
    .update({
      status: 'intake_complete',
      intake: sub as unknown as Record<string, unknown>,
      intake_completed_at: new Date().toISOString(),
      family_id: familyId,
      student_id: studentId,
      contact_name: `${sub.guardianFirst} ${sub.guardianLast}`.trim(),
      contact_email: sub.guardianEmail,
      contact_phone: sub.guardianPhone,
      student_name: `${sub.studentFirst} ${sub.studentLast}`.trim(),
      student_school: sub.school,
      student_grade: sub.grade,
      interest: sub.interest,
      subjects: sub.subjects,
      test_date: sub.testDate,
      prior_scores: sub.priorScores,
      availability_text: sub.availabilityText,
      online_preference: sub.onlinePreference,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)
  if (leadError) return { ok: false, error: leadError.message }

  return { ok: true, familyId, studentId }
}
