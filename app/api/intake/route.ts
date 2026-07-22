import { NextResponse } from 'next/server'
import { verifyIntakeToken, applyIntakeSubmission, type IntakeSubmission } from '../../utils/intake'
import { validAvailabilityRanges } from '../../utils/availability'
import { sendAdminAlert } from '../../utils/email'
import { ADMIN_EMAIL } from '../../utils/lifecycle'

// Public intake submission (Phase 7e, spec §11), authenticated by the signed
// link token — same trust model as the proposal/autopay links. Creates or
// updates the family + student (deduped by parent email — a group-class
// family is matched, never duplicated) and flips the lead to intake_complete.

const str = (v: unknown, max = 500): string | null => {
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

  const leadId = typeof body.token === 'string' ? verifyIntakeToken(body.token) : null
  if (!leadId) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  }

  const studentFirst = str(body.studentFirst, 100)
  const studentLast = str(body.studentLast, 100)
  const guardianFirst = str(body.guardianFirst, 100)
  const guardianLast = str(body.guardianLast, 100)
  const guardianEmail = str(body.guardianEmail, 200)?.toLowerCase() ?? null
  if (!studentFirst || !studentLast || !guardianFirst || !guardianLast) {
    return NextResponse.json({ error: 'Please fill in the student and guardian names.' }, { status: 400 })
  }
  if (!guardianEmail || !/^\S+@\S+\.\S+$/.test(guardianEmail)) {
    return NextResponse.json({ error: 'Please enter a valid guardian email address.' }, { status: 400 })
  }

  const interest = body.interest === 'subject' ? 'subject' : 'test_prep'
  const onlinePrefRaw = str(body.onlinePreference, 20)
  const onlinePreference =
    onlinePrefRaw === 'online' || onlinePrefRaw === 'in_person' || onlinePrefRaw === 'either'
      ? onlinePrefRaw
      : null
  const pick = <T extends string>(v: unknown, allowed: T[]): T | null =>
    typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : null

  // PL-19 structured availability grid — optional, and malformed grid data is
  // dropped rather than failing the submission (intake completion outranks
  // data completeness; the free-text answer still lands on the lead).
  const availability = validAvailabilityRanges(body.availability) ? body.availability : []
  let availabilityTimezone = str(body.availabilityTimezone, 60) ?? 'America/Denver'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: availabilityTimezone })
  } catch {
    availabilityTimezone = 'America/Denver'
  }

  const submission: IntakeSubmission = {
    studentFirst,
    studentLast,
    studentPhone: str(body.studentPhone, 50),
    studentEmail: str(body.studentEmail, 200)?.toLowerCase() ?? null,
    school: str(body.school, 200),
    pronouns: ['she_her', 'he_him', 'they_them'].includes(body.pronouns as string)
      ? (body.pronouns as string)
      : null,
    grade: str(body.grade, 50),
    guardianFirst,
    guardianLast,
    guardianPhone: str(body.guardianPhone, 50),
    guardianEmail,
    guardian2Name: str(body.guardian2Name, 200),
    guardian2Phone: str(body.guardian2Phone, 50),
    guardian2Email: str(body.guardian2Email, 200)?.toLowerCase() ?? null,
    preferredContactMethod: pick(body.preferredContactMethod, ['call', 'text', 'email']),
    absentContactWho: pick(body.absentContactWho, ['student', 'parent']),
    absentContactHow: pick(body.absentContactHow, ['call', 'text']),
    emergencyName: str(body.emergencyName, 200),
    emergencyPhone: str(body.emergencyPhone, 50),
    emergencyRelation: str(body.emergencyRelation, 100),
    howHeard: str(body.howHeard, 500),
    reason: str(body.reason, 2000),
    specialNeeds: str(body.specialNeeds, 2000),
    interest,
    testDate: str(body.testDate, 200),
    priorScores: str(body.priorScores, 500),
    subjects: str(body.subjects, 500),
    availabilityText: str(body.availabilityText, 2000),
    onlinePreference,
    availability,
    availabilityTimezone,
  }

  const result = await applyIntakeSubmission(leadId, submission)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // Heads-up to the Ops Director — one alert per lead (re-submits stay quiet).
  await sendAdminAlert({
    dedupeKey: `intake_complete:${leadId}`,
    adminEmail: ADMIN_EMAIL,
    templateKey: 'AL_INTAKE_COMPLETE',
    vars: { alertStudentName: `${studentFirst} ${studentLast}` },
    subject: `Intake complete — ${studentFirst} ${studentLast}`,
    body: `<p><strong>${guardianFirst} ${guardianLast}</strong> (${guardianEmail}) completed
      the intake form for <strong>${studentFirst} ${studentLast}</strong>
      (${interest === 'test_prep' ? 'test prep' : 'subject tutoring'}).</p>
      <p>The lead is marked intake-complete on /admin/leads — availability and all answers
      are on the lead record, ready for matching.</p>`,
  }).catch((e) => console.error('intake alert failed (submission stands):', e))

  return NextResponse.json({ ok: true })
}
