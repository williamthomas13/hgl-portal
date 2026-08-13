import type { EnrollmentEmailContext, Audience } from './email'
import { cancellationOptionsHtml, type CancellationOffer } from './cancellation-copy'
import {
  coverageAlertDetails,
  coverageNoteButtonHtml,
  coverageNoteHtml,
  coverageOutcomeLine,
  coverageSessionLines,
  type CoverageEvent,
} from './coverage-copy'
import { leadAssignedDetails } from './lead-assign-copy'
import { formatDateFull, zonedDeadline, friendlyZoneCity, bySessionStart } from './dates'
import type { ResolvedVars } from './comms-md'

// Feature A4 variable registry (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A4):
// the ONLY variables template bodies may use. Pronoun-conditional copy is
// expressed as paired variables (never raw conditionals) so the editor stays
// safe for non-developers. Block variables carry pre-rendered HTML and must
// stand alone as a paragraph.

const fmt = (iso: string | null | undefined) => (iso ? formatDateFull(iso.slice(0, 10)) : '—')

/** "5:00 PM" from "17:00" (12-hour, matching the register page). */
const fmt12h = (t: string | null): string | null => {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

/** PL-315: the full session schedule as MARKDOWN — the same facts the
 *  register page showed when the family signed up (dates, times, location,
 *  PL-305 friendly zone line) plus the course-calendar subscribe link.
 *  ONE source: the {sessionScheduleBlock} variable resolves this and the
 *  #0 code twins render it through comms-md, so both paths are identical.
 *  EMPTY when no sessions are scheduled yet (degrades to no block at all —
 *  never a dangling heading). */
export function sessionScheduleMarkdown(c: EnrollmentEmailContext): string {
  const sessions = [...(c.sessions ?? [])].sort(bySessionStart)
  if (sessions.length === 0) return ''
  const lines = sessions.map((s) => {
    const start = fmt12h(s.start_time)
    const end = fmt12h(s.end_time)
    const parts = [formatDateFull(s.session_date)]
    if (start) parts.push(end ? `${start}–${end}` : start)
    const loc = s.location ?? c.defaultLocation
    if (loc) parts.push(loc)
    return `- ${parts.join(' · ')}`
  })
  const zoneLine = c.timezone
    ? `\n\n(times shown in ${friendlyZoneCity(c.timezone, c.defaultLocation)} time)`
    : ''
  return `Here's the full session schedule:\n\n${lines.join('\n')}${zoneLine}\n\n[Add the class calendar to your own — subscribe here.](${c.calendarPageUrl})`
}

export type ExtraVars = {
  /** SU: pre-rendered list of what changed. */
  changesBlock?: string
  /** #9: pre-rendered package CTA buttons. */
  upsellPackagesBlock?: string
  /** W1 */
  waitlistPosition?: number
  /** W2 */
  claimDeadline?: string
  claimLink?: string
  /** PL-72: signed early-decline link (confirm page; JS-POST release). */
  declineLink?: string
  /** LR: "instructor + room" sentence (or the not-confirmed fallback). */
  classDetailsBlock?: string

  // --- PL-13 registry pass: tutoring (T-series) + cancellation (CX) ---------
  /** T1/T1b/T2/T4: billing month, e.g. "September 2026". */
  tutoringMonthLabel?: string
  /** T1: distinct student first names, e.g. "Roman & Ana". */
  studentNames?: string
  /** PL-299: the hours-block confirmation email's numbers. */
  blockHoursLeft?: string
  blockHours?: string
  tutoringHourlyRate?: string
  /** PL-323C: pre-rendered continue-outcome guts (reserved list or staff note). */
  blockContinueOutcomeBlock?: string
  /** PL-323E: the student's tutor, by name ("Ms. Rivera" reads wrong — use
   *  the instructor's stored display name). */
  studentTutorName?: string
  /** Tutor's full name / first name (T8, PL-40/41). */
  tutorName?: string
  tutorFirstName?: string
  /** T8: subject name, e.g. "SAT". */
  tutoringSubject?: string
  /** Pre-rendered per-student schedule lists (T1) or first-sessions block (T8). */
  scheduleBlock?: string
  /** PL-40/41: plain-English weekly summary, e.g. "Mondays at 4:00 PM…". */
  scheduleSummary?: string
  scheduleZoneNote?: string
  /** T1: "Month total: $620.00 — billed once you confirm…" or ''. */
  monthTotalLine?: string
  /** T1: package-covered note or ''. */
  packageNote?: string
  /** T1/T1b: signed proposal link. */
  confirmLink?: string
  /** PL-62: same link with ?confirm=1 — the page auto-confirms via a
   *  JS-executed POST on load (bot-safe: prefetchers don't run JS). */
  confirmOneTapLink?: string
  /** PL-41: signed one-click approval link. */
  approveLink?: string
  autoconfirmDays?: number
  daysLeft?: number
  /** T2: first paragraph (normal vs reminder wording). */
  invoiceIntroBlock?: string
  /** T2 subject: '' or 'Reminder: '. */
  invoiceReminderPrefix?: string
  invoiceTotal?: string
  invoiceDueDate?: string
  invoiceUrl?: string
  /** T2: autopay pitch paragraph or ''. */
  autopayBlock?: string
  /** T4: what failed + what happens next. */
  paymentFailBlock?: string
  /** T4: pay-now button or ''. */
  payButtonBlock?: string
  /** T3: before/after change list. */
  changeListBlock?: string
  /** CX: the offers/refund middle (options list, keep-your-hours note). */
  cancellationOptionsBlock?: string
  /** T7: signed intake form link. */
  intakeFormLink?: string
  /** T8: signed agreements + autopay links; T8 tutor/location lines. */
  agreementsLink?: string
  autopayLink?: string
  tutorContactLine?: string
  locationBlock?: string
  /** PL-40: schedule PDF link. */
  schedulePdfLink?: string
  /** §8 human-help block, pre-rendered from app_settings (PL-50). */
  contactBlock?: string

  // --- PL-53c: the #8 add-on-scheduling fork --------------------------------
  /** Unused add-on hours at send time, e.g. "5". */
  hoursRemaining?: string
  /** Availability ask, or the ready-to-propose variant when it's on file. */
  schedulingCtaBlock?: string

  // --- PL-54c: next-class-open notify -----------------------------------------
  /** e.g. "ISD SAT Prep — starts 13 October 2026, Tuesdays & Thursdays". */
  classSummaryLine?: string
  registrationLink?: string

  // --- PL-66: counselor / tutor / internal-alert registrations ---------------
  /** Counselor's first name (CS-set greeting). */
  counselorFirstName?: string
  /** CS digest subject count, e.g. "12 students enrolled" or "2 classes, 17 students enrolled". */
  digestCountSummary?: string
  /** PL-265: "class" or "classes" — agrees with the digest's class count. */
  digestClassNoun?: string
  /** CS digest per-class cards (pre-rendered). */
  digestClassListBlock?: string
  /** CS digest frequency-choice links line (pre-rendered). */
  digestFrequencyBlock?: string
  /** "3 days left" / "Last day" (CS deadline push subject). */
  deadlineCountdown?: string
  /** "3 spots" (CS deadline push). */
  spotsLeftPhrase?: string
  /** "12 of 15 enrolled" (CS deadline push). */
  enrolledCountLine?: string
  /** PL-270: "7 students" / "1 student" — paid enrollment as a phrase. */
  enrolledCountPhrase?: string
  /** PL-270: "3 students" / "1 student" — the class minimum as a phrase. */
  minStudentsPhrase?: string
  /** Waitlist depth as text, e.g. "2" (CS class-full). */
  waitlistDepth?: string
  /** Signed tell-us-the-room form link (CS classroom request). */
  classroomFormLink?: string

  // --- PL-214: CS class-confirmed welcome + SA sample announcement -----------
  /** The school's SALES page (hgl.co short link with protocol) — never the raw /register link. */
  salesPageLink?: string
  /** " and language (English and Spanish)" when a second collateral language exists; empty otherwise. */
  collateralLanguagesPhrase?: string
  /** SA: "from September 14 to October 1" (single-day: "on September 14"). */
  courseDatesPhrase?: string
  /** Enrollment deadline written out, e.g. "August 22, 2026". */
  enrollmentDeadline?: string
  /** Class capacity as text, e.g. "15". */
  classCapacity?: string

  // --- PL-219 v1.5: post-class survey -----------------------------------------
  /** The pre-bound per-student survey link (the only named channel). */
  surveyLink?: string
  /** Empty on the first ask; the "already did this in class? ignore us" paragraph on the reminder. */
  surveyReminderLine?: string
  /** "September 1 – September 15" (T5 timecard). */
  payPeriodRange?: string
  /** "14.5" (T5 timecard hours). */
  timecardHours?: string
  /** Tutor portal timecard link. */
  timecardLink?: string
  /** PL-111 (T6): "Wednesday, July 22" — the day whose notes are missing. */
  sessionDate?: string
  /** PL-111 (T6): pre-rendered list of sessions missing notes. */
  missingSessionsBlock?: string
  /** PL-111 (T6): tutor portal notes link. */
  notesLink?: string
  /** PL-112 (SUB): the offered session's details, pre-rendered lines. */
  coverageSessionBlock?: string
  /** PL-112 (SUB): tutor portal link where the candidate answers. */
  coverageRespondLink?: string
  /** PL-131: this counselor's no-login roster link for the class in hand. */
  counselorRosterLink?: string
  /** PL-112 (SUB): one-sentence outcome for the requesting tutor. */
  coverageOutcomeLine?: string
  /** PL-156: the hand-over note's rendered paragraphs (sub's email). */
  coverageNoteBlock?: string
  /** PL-156: who wrote it. */
  coverageNoteFrom?: string
  /** PL-156: the "Send X a note" button — EMPTY on declined/withdrawn. */
  coverageNoteButton?: string
  /** Tutor-facing what-changed deltas (pre-rendered; PL-81: the whole batch). */
  tutorChangeBlock?: string
  /** PL-81: "Schedule change" or "3 schedule changes" — subject scales. */
  scheduleChangeCountPhrase?: string
  /** PL-81: each affected student's CURRENT upcoming schedule, listed before
   *  the deltas so any single notice carries the whole truth. */
  tutorScheduleBlock?: string
  /** Internal alerts: who/what the alert is about. */
  alertStudentName?: string
  alertParentName?: string
  alertParentEmail?: string
  /** e.g. "3 enrolled / 8 min / 15 cap" or "4 paid / 8 minimum". */
  alertCounts?: string
  /** The alert's composed data guts (pre-rendered HTML) — framing copy is
   *  editable in the template; the computed details ride this block. */
  alertDetailsBlock?: string
  /** PL-89: when #4 (class details) goes to families, written out — derived
   *  from the SEQUENCE offset at compose time. */
  classDetailsSendDate?: string
  /** PL-264: the same fact as a tense-aware phrase — "goes out {date}" or
   *  "is overdue" once the date has passed. */
  classDetailsSendPhrase?: string
  /** PL-262: the requested session's local time, written out — "Wed, Aug 5, 4:00 PM". */
  sessionWhenPhrase?: string
  /** PL-262: the session's subject, e.g. "French". */
  subjectName?: string
  /** PL-262: the inside-24h fee caveat, or empty when 24h+ notice. */
  lateFeeNoteBlock?: string

  // --- PL-76: cancelled-class → tutoring conversion --------------------------
  /** "$899.00" — the cancelled class's paid amount, now a tutoring credit. */
  creditAmount?: string
  /** PL-84: the CX-T terms sentence — hours variant when the cancellation
   *  carried an hours offer, dollar-credit wording only as the fallback. */
  conversionTermsBlock?: string
  /** Override for stub-context sends (CX-T): the family's tokenized page. */
  availabilityLink?: string

  // --- PL-78: instructor emails (IN_WELCOME / IN_DIGEST / IN_FYI) -------------
  /** PL-73 format: "6 enrolled / 8 min / 15 cap". */
  instructorCountsLine?: string
  /** The instructor's own class page in the portal. */
  instructorViewLink?: string
  /** "August 20, 2026" — while the registration window is open. */
  registrationCloseDate?: string
  /** Milestone variant line for IN_DIGEST ('' on quiet weekly sends). */
  digestMilestoneLine?: string
  /** PL-95: IN_DIGEST's per-variant "what happens from here" footer. */
  digestNextStepsBlock?: string
  /** PL-80c: IN_WELCOME's class-session list — renamed from {scheduleBlock}
   *  so it can never collide with the tutoring sample again. */
  classScheduleBlock?: string
  /** IN_FYI: the family email's original subject. */
  fyiOriginalSubject?: string
  /** IN_FYI: the family email's rendered body (extracted, pre-wrapped HTML). */
  familyEmailBlock?: string
  /** PL-335 D: IN_MIN_DECISION subject tail — "running as planned" ·
   *  "registration deadline extended to September 12". */
  minDecisionSubject?: string
  /** PL-335 D: the decision sentence, composed per variant (markdown). */
  minDecisionLine?: string
}

type Resolver = (ctx: EnrollmentEmailContext, audience: Audience, extra: ExtraVars) => string

type VariableDef = {
  description: string
  block?: boolean
  /** Batch-32: the block's VALUE is markdown (bold/links/buttons) and must
   *  render through comms-md rather than inserting raw. HTML-carrying
   *  blocks (pre-rendered order summaries etc.) leave this unset. */
  md?: boolean
  resolve: Resolver
}

const s = (ctx: EnrollmentEmailContext) => ctx.studentFirstName

// PL-69: the one student-pronoun source (mirrors studentPronounSet in
// email.ts for the code twins). Unset resolves to exactly the they/them copy
// every email used before pronouns existed. Verb agreement rides along.
// PL-80: 'name_only' ("Something else / rather not say") substitutes the
// student's name wherever a pronoun would go — the name-based forms that
// already existed ("Ana has", "Ana's"). Repetition is acceptable and warm;
// a wrong pronoun never is. Explicit choice only — unset stays they/them.
function pn(ctx: EnrollmentEmailContext) {
  switch (ctx.studentPronouns) {
    case 'she_her':
      return { subj: 'she', obj: 'her', poss: 'her', have: 'has', need: 'needs', dont: "doesn't", is: 'is' }
    case 'he_him':
      return { subj: 'he', obj: 'him', poss: 'his', have: 'has', need: 'needs', dont: "doesn't", is: 'is' }
    case 'name_only':
      return {
        subj: ctx.studentFirstName,
        obj: ctx.studentFirstName,
        poss: `${ctx.studentFirstName}'s`,
        have: 'has',
        need: 'needs',
        dont: "doesn't",
        is: 'is',
      }
    default:
      return { subj: 'they', obj: 'them', poss: 'their', have: 'have', need: 'need', dont: "don't", is: 'are' }
  }
}

function classroomValue(ctx: EnrollmentEmailContext): string {
  const loc = ctx.defaultLocation
  if (!loc) return 'TBD'
  return /^https?:\/\//i.test(loc) ? `<a href="${loc}">${loc}</a>` : loc
}

// PL-68/PL-71: the ONE mode-aware "where classes happen" builder — #4 v3,
// #5 v4, LR's {classDetailsBlock}, and the entry previews all render from
// here, so the wording can never drift between the emails and the hints.
//   in-person → "in Room 204"
//   online    → "online — here's the meeting link: <link>"
export function classLocationTailText(
  location: string | null | undefined,
  deliveryMode: string | null | undefined
): string {
  const loc = location?.trim()
  if (deliveryMode === 'online') {
    return loc
      ? `online — here's the meeting link: ${loc}`
      : `online — we'll send the meeting link before class`
  }
  return `in ${loc || 'TBD'}`
}

function classLocationTailHtml(
  location: string | null | undefined,
  deliveryMode: string | null | undefined
): string {
  const loc = location?.trim()
  if (deliveryMode === 'online' && loc && /^https?:\/\//i.test(loc)) {
    return `online — here's the meeting link: <a href="${loc}">${loc}</a>`
  }
  return classLocationTailText(location, deliveryMode)
}

/** The full preview sentence for the admin/counselor entry hints. */
export function classLocationSentence(
  location: string | null | undefined,
  deliveryMode: string | null | undefined = 'in_person'
): string {
  return `All classes will take place ${classLocationTailText(location, deliveryMode)}.`
}

// PL-67: first name only for mid-sentence instructor mentions (#6 onward) —
// the introducing emails (#4, LR) keep the full name.
function instructorFirstValue(ctx: EnrollmentEmailContext): string {
  return ctx.instructorName?.trim().split(/\s+/)[0] || 'the instructor'
}

function synapUrlValue(ctx: EnrollmentEmailContext): string {
  const v = ctx.synapGroup
  // PL-60: never a dead "#" button — until the class's Synap group is set,
  // the link lands on the parent portal (alive, explains the class) instead
  // of anchoring the recipient to their own email.
  if (!v) return ctx.portalUrl
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

export const VARIABLES: Record<string, VariableDef> = {
  // --- people ---------------------------------------------------------------
  parentFirstName: { description: "Parent's first name", resolve: (c) => c.parentFirstName },
  studentFirstName: { description: "Student's first name", resolve: (c) => c.studentFirstName },
  studentLastName: { description: "Student's last name", resolve: (c) => c.studentLastName },
  studentEmail: { description: "Student's email (— when blank)", resolve: (c) => c.studentEmail ?? '—' },
  // PL-71d: parent-only pass-along clause for LR's register instructions —
  // empty on the student send.
  together_or_blank: {
    description:
      'Parent send: " — you can do it together or just pass this along to {studentFirstName}" · student send: empty',
    resolve: (c, a) =>
      a === 'student' ? '' : ` — you can do it together or just pass this along to ${c.studentFirstName}`,
  },
  recipientFirstName: {
    description: 'Parent name on the parent send, student name on the student send',
    resolve: (c, a) => (a === 'student' ? c.studentFirstName : c.parentFirstName),
  },
  instructorName: {
    description: 'Instructor (or "to be announced")',
    resolve: (c) => c.instructorName ?? 'to be announced',
  },
  // PL-67a: mid-sentence mentions read better as "Jordan" than "Jordan
  // Rivera" — mirror of tutorFirstName.
  instructorFirstName: {
    description: 'Instructor first name (or "the instructor")',
    resolve: (c) => instructorFirstValue(c),
  },
  // PL-67b: the #6 opening clause. The auxiliary verb shifts with BOTH the
  // audience and whether the class is over at send time, so it is one
  // composed variable rather than nested conditionals.
  takingAdvantagePhrase: {
    description:
      '#6 clause, audience- and tense-aware: ongoing → "Ana has been taking advantage of their class time with Jordan" (student send: "you have been… your…"); once the last session is past → "Ana was able to take advantage…" / "you were able to take advantage…"',
    resolve: (c, a) => {
      const first = instructorFirstValue(c)
      const ended = new Date().toISOString().slice(0, 10) > (c.lastSession ?? '')
      const who = a === 'student' ? 'you' : c.studentFirstName
      // PL-69: possessive follows the student's pronouns (unset → their).
      const poss = a === 'student' ? 'your' : pn(c).poss
      const verb = ended
        ? a === 'student'
          ? 'were able to take advantage'
          : 'was able to take advantage'
        : a === 'student'
          ? 'have been taking advantage'
          : 'has been taking advantage'
      return `${who} ${verb} of ${poss} class time with ${first}`
    },
  },

  // --- class ----------------------------------------------------------------
  schoolName: { description: 'Full school name', resolve: (c) => c.schoolName },
  schoolNickname: { description: 'School nickname (e.g. SLS)', resolve: (c) => c.schoolNickname },
  classType: { description: 'e.g. SAT Prep', resolve: (c) => c.classType },
  className: { description: '"{schoolNickname} {classType}"', resolve: (c) => c.className },
  firstSessionDate: { description: 'First class date, written out', resolve: (c) => fmt(c.firstSession) },
  lastSessionDate: { description: 'Last class date, written out', resolve: (c) => fmt(c.lastSession) },
  diagnosticDueDate: {
    description: 'Diagnostic deadline (day before first class)',
    resolve: (c) => fmt(c.diagnosticDueDate),
  },
  classTime: {
    description: 'Uniform session time range, or a calendar-page fallback phrase',
    block: true, // may contain a link in the fallback case
    resolve: (c) =>
      c.classTime ?? `the times shown on <a href="${c.calendarPageUrl}">the class calendar</a>`,
  },
  classroom: {
    description: 'Room, or the meeting link for online classes ("TBD" when blank)',
    block: true,
    resolve: (c) => classroomValue(c),
  },
  // PL-58: the portal knows delivery_mode at render time — no more
  // "for both in-person and online" hedging.
  classLocationPhrase: {
    description: 'Per delivery mode: "the classroom location" (in-person) or "the meeting link for class" (online)',
    resolve: (c) => (c.deliveryMode === 'online' ? 'the meeting link for class' : 'the classroom location'),
  },
  // ------- PL-274 amendment B/F: switch-aware composed pieces. All resolve
  // straight from the enrollment context — no extras plumbing, so every send
  // path (sweep, inline, projector previews) conditions identically.
  e0IncludesPhrase: {
    description: "PL-274: E0-P's what-you'll-get list — drops 'diagnostic test information' when the class has no diagnostics",
    resolve: (c) => {
      const loc = c.deliveryMode === 'online' ? 'the meeting link for class' : 'the classroom location'
      return c.hasDiagnostics
        ? `diagnostic test information, instructor information, and ${loc}`
        : `instructor information and ${loc}`
    },
  },
  e0StudentIncludesPhrase: {
    description: "PL-274: E0-S's what-you'll-get list, diagnostics-aware",
    resolve: (c) => {
      const loc = c.deliveryMode === 'online' ? 'the meeting link for class' : 'the classroom location'
      return c.hasDiagnostics
        ? `${loc} and information to access your initial diagnostic test`
        : loc
    },
  },
  sessionScheduleBlock: {
    description:
      "PL-315: the full session schedule (dates, times, location, timezone line) + the course-calendar subscribe link — EMPTY while the class has no sessions scheduled",
    block: true,
    md: true,
    resolve: (c) => sessionScheduleMarkdown(c),
  },
  diagnosticDueLine: {
    description: 'PL-274: the "(By the way, that test is due {date}!)" aside — EMPTY when the class has no diagnostics',
    block: true,
    md: true,
    resolve: (c) =>
      c.hasDiagnostics ? `(By the way, that test is due ${fmt(c.diagnosticDueDate)}!)` : '',
  },
  e1IncludesPhrase: {
    description: "PL-274: #1's course-information list, diagnostics-aware",
    resolve: (c) => {
      const loc = c.deliveryMode === 'online' ? 'the meeting link for class' : 'the classroom location'
      return c.hasDiagnostics ? `${loc} and diagnostic test access` : loc
    },
  },
  vfaqLocationAnswer: {
    description: 'PL-274: #3\'s location Q&A — states the KNOWN location/meeting link when set (open classes always know it at creation); the old "not confirmed yet" copy only when genuinely blank',
    block: true,
    md: true,
    resolve: (c) => {
      const q = "**What's the exact location for the class?**"
      if (c.defaultLocation) {
        return c.deliveryMode === 'online'
          ? `${q}\nClass meets online — your meeting link: [${c.defaultLocation}](${c.defaultLocation})`
          : `${q}\n${c.defaultLocation} — see you there!`
      }
      return `${q}\nWe don't have that information confirmed just yet, but we'll write you again when we know!`
    },
  },
  vfaqDiagnosticQa: {
    description: 'PL-274: #3\'s diagnostic Q&A — EMPTY when the class has no diagnostics',
    block: true,
    md: true,
    resolve: (c) =>
      c.hasDiagnostics
        ? `**What if I didn't get the diagnostic test information?**\nNo problem — you can get to it right here: [button:Take the diagnostic test](${synapUrlValue(c)}). It's due ${fmt(c.diagnosticDueDate)}, the day before your first class.`
        : '',
  },
  instructorBioBlock: {
    description: 'PL-274 F: the instructor-introduction paragraph from instructors.bio — EMPTY when no bio is on record (never a dangling sentence)',
    block: true,
    md: true,
    resolve: (c) => (c.instructorBio ? c.instructorBio : ''),
  },
  openClassMeetingBlock: {
    description: 'PL-274 F: for online open-enrollment classes, "All classes will take place here:" + the meeting link — EMPTY otherwise',
    block: true,
    md: true,
    resolve: (c) =>
      c.isOpenEnrollment && c.deliveryMode === 'online' && c.defaultLocation
        ? `All classes will take place here:\n\n[${c.defaultLocation}](${c.defaultLocation})`
        : '',
  },
  diagnosticPsE4Block: {
    description: "PL-274: #4's pronoun-aware diagnostic P.S. + button — EMPTY when the class has no diagnostics",
    block: true,
    md: true,
    resolve: (c, a) =>
      c.hasDiagnostics
        ? `P.S. If ${a === 'student' ? "you haven't" : `${s(c)} hasn't`} found a moment to take the diagnostic test yet, ${a === 'student' ? 'you' : pn(c).subj} can still do so by clicking below. If ${a === 'student' ? 'you have' : `${pn(c).subj} ${pn(c).have}`} already completed the test, no need to let us know. We surely have it.\n\n[button:Access Diagnostic Tests](${synapUrlValue(c)})`
        : '',
  },
  diagnosticPsE5Block: {
    description: "PL-274: #5's pronoun-aware diagnostic P.S. — EMPTY when the class has no diagnostics",
    block: true,
    md: true,
    resolve: (c, a) =>
      c.hasDiagnostics
        ? `P.S. If ${a === 'student' ? "you still haven't" : `${s(c)} still hasn't`} taken the first diagnostic test, don't worry. It's still available [here](${synapUrlValue(c)}).`
        : '',
  },
  // PL-71: the composed mode-aware "where" — templates write
  // "…take place {classLocationLine}" and it renders "in Room 204" or
  // "online — here's the meeting link: <link>".
  classLocationLine: {
    description:
      "Mode-aware, follows \"take place\": in-person → \"in Room 204\" · online → \"online — here's the meeting link: <link>\"",
    block: true, // may contain the meeting-link anchor
    resolve: (c) => classLocationTailHtml(c.defaultLocation, c.deliveryMode),
  },
  // PL-65: subject-safe (title-case, no article) sibling of the above —
  // "Classroom location for {className}" / "Meeting link for {className}".
  locationNounTitle: {
    description: 'Per delivery mode, subject-safe: "Classroom location" (in-person) or "Meeting link" (online)',
    resolve: (c) => (c.deliveryMode === 'online' ? 'Meeting link' : 'Classroom location'),
  },
  examName: {
    description: 'SAT / ACT / "the exam"',
    resolve: (c) => c.examInfo?.examName ?? 'the exam',
  },
  examRegistrationLink: {
    description: 'College Board / ACT registration link, per class type',
    block: true,
    resolve: (c) =>
      c.examInfo
        ? `<a href="${c.examInfo.regUrl}">${c.examInfo.regLabel}</a>`
        : `the official testing organization's website`,
  },

  // --- money / registration --------------------------------------------------
  price: { description: 'Class price, e.g. $450', resolve: (c) => `$${c.price}` },
  amountPaid: {
    description: 'Amount actually charged',
    resolve: (c) => (c.amountPaid != null ? `$${c.amountPaid}` : `$${c.price}`),
  },
  paymentDate: { description: 'Date payment landed', resolve: (c) => (c.paidAt ? fmt(c.paidAt) : '—') },
  expiryDate: {
    description: 'When a pending registration expires (7 days after signup) — zoned datetime (PL-118)',
    resolve: (c) =>
      // PL-305: the class's own city when the location names one.
      zonedDeadline(new Date(new Date(c.enrolledAt).getTime() + 168 * 3_600_000), c.timezone, c.defaultLocation),
  },

  // --- links ------------------------------------------------------------------
  calendarLink: { description: 'Class calendar landing page', resolve: (c) => c.calendarPageUrl },
  synapGroupLink: { description: 'Diagnostic test (Synap) group link', resolve: (c) => synapUrlValue(c) },
  resumePaymentLink: { description: 'Signed finish-payment link (PR emails)', resolve: (c) => c.resumePaymentUrl },
  portalLink: { description: 'Signed parent-portal deep link', resolve: (c) => c.portalUrl },
  claimLink: { description: 'W2: signed 48h claim link', resolve: (_c, _a, e) => e.claimLink ?? '#' },
  declineLink: {
    description: 'W2: signed decline-the-spot link (PL-72 — cascades to the next family)',
    resolve: (c, _a, e) => e.declineLink ?? c.portalUrl,
  },
  compassLink: { description: 'College Prep Compass', resolve: () => 'http://hgl.co/college-prep-compass' },
  reviewLink: { description: 'Google review page', resolve: () => 'https://g.page/highergroundlearning/review?gm' },
  discountLink: { description: 'Discounted tutoring page', resolve: () => 'https://highergroundprep.com/discount' },
  faqLinks: {
    description: 'The four FAQ section links, inline',
    block: true,
    resolve: () =>
      `<a href="https://highergroundlearning.com/faqs#general">General</a> · <a href="https://highergroundlearning.com/faqs#diagnostic-tests">Diagnostic tests</a> · <a href="https://highergroundlearning.com/faqs#attendance">Attendance</a> · <a href="https://highergroundlearning.com/faqs#1on1">1-on-1 tutoring</a>`,
  },

  // --- pronoun pairs (audience-aware; spec: paired variables, no conditionals)
  you_or_name: { description: '"you" ↔ student name', resolve: (c, a) => (a === 'student' ? 'you' : s(c)) },
  your_or_names: {
    description: `"your" ↔ "Ana's"`,
    resolve: (c, a) => (a === 'student' ? 'your' : `${s(c)}'s`),
  },
  you_or_they: {
    description: '"you" ↔ the student\'s pronoun (she / he / they / the name for name_only; unset → they)',
    resolve: (c, a) => (a === 'student' ? 'you' : pn(c).subj),
  },
  your_or_their: {
    description: '"your" ↔ the student\'s possessive (her / his / their / "Ana\'s"; unset → their)',
    resolve: (c, a) => (a === 'student' ? 'your' : pn(c).poss),
  },
  youre_or_name_is: {
    description: `"You're" ↔ "Ana is"`,
    resolve: (c, a) => (a === 'student' ? "You're" : `${s(c)} is`),
  },
  you_have_or_name_has: {
    description: '"you have" ↔ "Ana has"',
    resolve: (c, a) => (a === 'student' ? 'you have' : `${s(c)} has`),
  },
  you_have_or_they_have: {
    description: '"you have" ↔ "she has / he has / they have / Ana has" (verb agrees; unset → they have)',
    resolve: (c, a) => (a === 'student' ? 'you have' : `${pn(c).subj} ${pn(c).have}`),
  },
  you_need_or_they_need: {
    description: '"you need" ↔ "she needs / he needs / they need / Ana needs" (verb agrees; unset → they need)',
    resolve: (c, a) => (a === 'student' ? 'you need' : `${pn(c).subj} ${pn(c).need}`),
  },
  you_dont_or_they_dont: {
    description: `"you don't" ↔ "she doesn't / he doesn't / they don't / Ana doesn't" (verb agrees; unset → they don't)`,
    resolve: (c, a) => (a === 'student' ? "you don't" : `${pn(c).subj} ${pn(c).dont}`),
  },
  // PL-69: standalone pronoun variables (student's, regardless of audience).
  she_he_they: {
    description: "The student's subject pronoun: she / he / they — or the name for name_only (unset → they)",
    resolve: (c) => pn(c).subj,
  },
  her_him_them: {
    description: "The student's object pronoun: her / him / them — or the name for name_only (unset → them)",
    resolve: (c) => pn(c).obj,
  },
  her_his_their: {
    description: "The student's possessive: her / his / their — or \"Ana's\" for name_only (unset → their)",
    resolve: (c) => pn(c).poss,
  },
  // PL-282: verb agreement partner for {she_he_they} — "she is / they are".
  is_are: {
    description: `"is" ↔ "are", agreeing with {she_he_they} ("she is / he is / they are / Ana is"; unset → are)`,
    resolve: (c) => pn(c).is,
  },
  // PL-279: the FO follow-up campaign's offer variables. They resolve from
  // ctx.followOn, which ONLY the FO sweep (and the sample context) attaches
  // — per-cohort values, computed from the recipient's own feeder class.
  // Outside an FO send they resolve empty rather than crashing every other
  // template's render (resolveVariables evaluates the whole vocabulary).
  followOnClassName: {
    description: 'The follow-up class being marketed, e.g. "SAT Math Deep Dive" (FO emails only)',
    resolve: (c) => c.followOn?.className ?? '',
  },
  followOnShortName: {
    description: 'The follow-up class\'s short marketing name, e.g. "Deep Dive" (roster-editable on the open class; falls back to the full name)',
    resolve: (c) => c.followOn?.shortName ?? '',
  },
  followOnRegistrationLink: {
    description: "The recipient's own tokenized registration link — auto-applies the discount with their cohort's deadline baked in (typed code = fallback)",
    resolve: (c) => c.followOn?.registrationLink ?? '',
  },
  discountAmount: {
    description: 'The follow-up discount, formatted ("$50") — the open class\'s promo amount',
    resolve: (c) => c.followOn?.discountAmount ?? '',
  },
  discountCode: {
    description: "The shared discount code (the open class's promo code) — validated per cohort at checkout",
    resolve: (c) => c.followOn?.discountCode ?? '',
  },
  endDate: {
    description: 'THIS cohort\'s discount deadline, written out (e.g. "Friday, September 25, 2026") — computed from the recipient\'s feeder class, extension-aware',
    resolve: (c) => c.followOn?.endDate ?? '',
  },
  // PL-293: the small "More info" pointer to the class's Squarespace
  // marketing page (classes.marketing_url) — EMPTY when no page is set, so
  // nothing dangles.
  // PL-299: the hours-block confirmation email's numbers (extras-resolved —
  // the sweep computes them from the live drawdown).
  blockHoursLeft: {
    description: 'PL-299: hours remaining on the purchased block, e.g. "3"',
    resolve: (_c, _a, e) => e.blockHoursLeft ?? '',
  },
  blockHours: {
    description: 'PL-299: the purchased block size, e.g. "15"',
    resolve: (_c, _a, e) => e.blockHours ?? '',
  },
  tutoringHourlyRate: {
    description: 'PL-299: the CONTINUING hourly rate, formatted ("$105") — PL-323D: follows the student\'s domestic/international provenance via the price list',
    resolve: (_c, _a, e) => e.tutoringHourlyRate ?? '',
  },
  studentTutorName: {
    description: "PL-323: the student's tutor's name (BL block-confirm email)",
    resolve: (_c, _a, e) => e.studentTutorName ?? 'their tutor',
  },
  blockContinueOutcomeBlock: {
    description: 'PL-323C: the continue-outcome guts — reserved session list, or the our-team-is-on-it note',
    block: true,
    resolve: (_c, _a, e) => e.blockContinueOutcomeBlock ?? '',
  },
  followOnInfoBlock: {
    description:
      'PL-293: "More info about the class →" linking the class\'s marketing page (set per class on the roster) — EMPTY when no marketing page is set',
    block: true,
    md: true,
    resolve: (c) =>
      c.followOn?.infoUrl
        ? `**[More info about ${c.followOn.className} →](${c.followOn.infoUrl})**`
        : '',
  },
  Your_or_names: {
    description: `Sentence-start "Your" ↔ "Ana's"`,
    resolve: (c, a) => (a === 'student' ? 'Your' : `${s(c)}'s`),
  },
  you_havent_or_name_hasnt: {
    description: `"you haven't" ↔ "Ana hasn't"`,
    resolve: (c, a) => (a === 'student' ? "you haven't" : `${s(c)} hasn't`),
  },
  you_still_havent_or_name_still_hasnt: {
    description: `"you still haven't" ↔ "Ana still hasn't"`,
    resolve: (c, a) => (a === 'student' ? "you still haven't" : `${s(c)} still hasn't`),
  },
  you_dont_or_name_doesnt: {
    description: `"you don't" ↔ "Ana doesn't"`,
    resolve: (c, a) => (a === 'student' ? "you don't" : `${s(c)} doesn't`),
  },
  you_miss_or_name_misses: {
    description: '"you miss" ↔ "Ana misses"',
    resolve: (c, a) => (a === 'student' ? 'you miss' : `${s(c)} misses`),
  },
  for_you_or_for_name: {
    description: '"for you" ↔ "for Ana"',
    resolve: (c, a) => (a === 'student' ? 'for you' : `for ${s(c)}`),
  },
  for_name_or_blank: {
    description: '"for Ana " on the parent send, empty on the student send (#4)',
    resolve: (c, a) => (a === 'student' ? '' : `for ${s(c)} `),
  },

  // --- PL-13: tutoring + cancellation (resolve from extras; the T/CX sends
  // pass a tutoring stub context, so ctx-based variables above still resolve
  // sensibly where shared, e.g. parentFirstName/studentFirstName) -----------
  tutoringMonthLabel: { description: 'Billing month, e.g. "September 2026"', resolve: (_c, _a, e) => e.tutoringMonthLabel ?? '—' },
  studentNames: { description: 'Student first names, e.g. "Roman & Ana"', resolve: (c, _a, e) => e.studentNames ?? c.studentFirstName },
  tutorName: { description: "Tutor's name", resolve: (_c, _a, e) => e.tutorName ?? 'your tutor' },
  tutorFirstName: { description: "Tutor's first name", resolve: (_c, _a, e) => e.tutorFirstName ?? e.tutorName?.split(' ')[0] ?? 'your tutor' },
  tutoringSubject: { description: 'Tutoring subject, e.g. "SAT"', resolve: (_c, _a, e) => e.tutoringSubject ?? 'tutoring' },
  scheduleBlock: { description: 'Pre-rendered session schedule list', block: true, resolve: (_c, _a, e) => e.scheduleBlock ?? '' },
  scheduleSummary: { description: 'Plain-English weekly plan, e.g. "Mondays at 4:00 PM…"', resolve: (_c, _a, e) => e.scheduleSummary ?? '—' },
  // PL-147: present only when the family's zone and the tutor's zone can
  // drift apart (Phoenix, international families) — empty otherwise, so the
  // sentence never appears where it would just be noise.
  scheduleZoneNote: {
    description: 'Daylight-saving anchor note; empty when both zones shift together',
    block: true,
    resolve: (_c, _a, e) => e.scheduleZoneNote ?? '',
  },
  monthTotalLine: { description: 'Month total sentence (empty when package-covered)', block: true, resolve: (_c, _a, e) => e.monthTotalLine ?? '' },
  packageNote: { description: 'Package-covered note (often empty)', block: true, resolve: (_c, _a, e) => e.packageNote ?? '' },
  confirmLink: { description: 'Signed schedule-proposal link', resolve: (_c, _a, e) => e.confirmLink ?? '#' },
  confirmOneTapLink: {
    description: 'Proposal link that confirms in one tap on landing (PL-62)',
    resolve: (_c, _a, e) => e.confirmOneTapLink ?? e.confirmLink ?? '#',
  },
  approveLink: { description: 'PL-41 signed one-click approval link', resolve: (_c, _a, e) => e.approveLink ?? '#' },
  autoconfirmDays: { description: 'Days until the proposal auto-confirms', resolve: (_c, _a, e) => String(e.autoconfirmDays ?? 5) },
  daysLeft: { description: 'Days left before auto-confirm (nudge)', resolve: (_c, _a, e) => String(e.daysLeft ?? 3) },
  invoiceIntroBlock: { description: 'T2 first paragraph (normal vs reminder)', block: true, resolve: (_c, _a, e) => e.invoiceIntroBlock ?? '' },
  invoiceReminderPrefix: { description: '"" or "Reminder: " (T2 subject)', resolve: (_c, _a, e) => e.invoiceReminderPrefix ?? '' },
  invoiceTotal: { description: 'Invoice total, e.g. $620.00', resolve: (_c, _a, e) => e.invoiceTotal ?? '—' },
  invoiceDueDate: { description: 'Due date, e.g. "August 31"', resolve: (_c, _a, e) => e.invoiceDueDate ?? '—' },
  invoiceUrl: { description: 'Hosted invoice (view & pay) link', resolve: (_c, _a, e) => e.invoiceUrl ?? '#' },
  autopayBlock: { description: 'Autopay pitch paragraph (may be empty)', block: true, resolve: (_c, _a, e) => e.autopayBlock ?? '' },
  paymentFailBlock: { description: 'T4: what failed + what happens next', block: true, resolve: (_c, _a, e) => e.paymentFailBlock ?? '' },
  payButtonBlock: { description: 'T4: pay-now button (may be empty)', block: true, resolve: (_c, _a, e) => e.payButtonBlock ?? '' },
  changeListBlock: { description: 'T3: before/after change list', block: true, resolve: (_c, _a, e) => e.changeListBlock ?? '' },
  cancellationOptionsBlock: {
    description: 'CX: the options/refund middle (offers, keep-your-hours note)',
    block: true,
    resolve: (_c, _a, e) => e.cancellationOptionsBlock ?? '',
  },
  intakeFormLink: { description: 'T7 signed intake form link', resolve: (_c, _a, e) => e.intakeFormLink ?? '#' },
  agreementsLink: { description: 'Signed policies (agreements) link', resolve: (_c, _a, e) => e.agreementsLink ?? '#' },
  autopayLink: { description: 'Signed autopay setup link', resolve: (_c, _a, e) => e.autopayLink ?? '#' },
  tutorContactLine: { description: 'T8 "Your tutor: … — email" line', block: true, resolve: (_c, _a, e) => e.tutorContactLine ?? '' },
  locationBlock: { description: 'T8 where-sessions-happen line (may be empty)', block: true, resolve: (_c, _a, e) => e.locationBlock ?? '' },
  schedulePdfLink: { description: 'PL-40 schedule PDF download link', resolve: (_c, _a, e) => e.schedulePdfLink ?? '#' },
  contactBlock: {
    description: 'The §8 human-help block (from the configurable contact, PL-50)',
    block: true,
    resolve: (_c, _a, e) => e.contactBlock ?? '',
  },

  // --- PL-53: add-on hours lifecycle ----------------------------------------
  addonHours: {
    description: "Total 1-on-1 add-on hours on this enrollment ('0' when none)",
    resolve: (c) => String(c.addons.reduce((sum, a) => sum + a.hours, 0)),
  },
  availabilityLink: {
    description: "The family's signed share-your-availability page",
    resolve: (c, _a, e) => e.availabilityLink ?? c.availabilityUrl,
  },
  addonTutoringBlock: {
    description: '#0: the your-tutoring-hours paragraph — renders EMPTY for class-only enrollments',
    block: true,
    resolve: (c) => {
      const hours = c.addons.reduce((sum, a) => sum + a.hours, 0)
      if (hours <= 0) return ''
      return `<p><strong>Your 1-on-1 tutoring hours.</strong> Your registration includes ${hours} hours of 1-on-1 tutoring. In our experience they're most valuable <em>after</em> the class ends — that's when a tutor can zero in on exactly what your student needs next. When the class wraps up, we'll reach out to get ${c.studentFirstName} scheduled. If you want to start earlier instead, just <a href="${c.availabilityUrl}" style="color:#00AEEE">share your availability</a> and we'll propose times. It's no problem if you're not sure yet; we'll ask you again once the class is done.</p>`
    },
  },
  hoursRemaining: {
    description: 'PL-53c: unused add-on hours at #8 time (pre-rendered by the sweep)',
    resolve: (_c, _a, e) => e.hoursRemaining ?? '—',
  },
  schedulingCtaBlock: {
    description: 'PL-53c: availability ask, or "we\'re ready to propose times" when it\'s on file',
    block: true,
    resolve: (_c, _a, e) => e.schedulingCtaBlock ?? '',
  },

  classSummaryLine: {
    description: 'PL-54: one-line summary of the newly opened class',
    block: true,
    resolve: (_c, _a, e) => e.classSummaryLine ?? '',
  },
  registrationLink: {
    description: 'PL-54: the /register link for the newly opened class',
    resolve: (_c, _a, e) => e.registrationLink ?? '#',
  },

  // --- PL-66: counselor / tutor / internal-alert registrations ---------------
  counselorFirstName: { description: "Counselor's first name (CS set)", resolve: (_c, _a, e) => e.counselorFirstName ?? 'there' },
  digestCountSummary: { description: 'CS digest count, e.g. "12 students enrolled"', resolve: (_c, _a, e) => e.digestCountSummary ?? '—' },
  // PL-265: "class" or "classes" to match how many the digest actually covers.
  digestClassNoun: { description: 'PL-265: "class" or "classes", agreeing with the digest\'s actual class count', resolve: (_c, _a, e) => e.digestClassNoun ?? 'classes' },
  digestClassListBlock: { description: 'CS digest per-class cards', block: true, resolve: (_c, _a, e) => e.digestClassListBlock ?? '' },
  digestFrequencyBlock: { description: 'CS digest frequency-choice links', block: true, resolve: (_c, _a, e) => e.digestFrequencyBlock ?? '' },
  deadlineCountdown: { description: '"3 days left" / "Last day" (CS push subject)', resolve: (_c, _a, e) => e.deadlineCountdown ?? '—' },
  spotsLeftPhrase: { description: '"3 spots" (CS push)', resolve: (_c, _a, e) => e.spotsLeftPhrase ?? '—' },
  enrolledCountLine: { description: '"12 of 15 enrolled" (CS push)', resolve: (_c, _a, e) => e.enrolledCountLine ?? '—' },
  // PL-270: the FP rewrite's last paragraph — enrolled count and the class
  // minimum, both plural-safe phrases.
  enrolledCountPhrase: { description: 'PL-270: "7 students" / "1 student" — paid enrollment (FP push)', resolve: (_c, _a, e) => e.enrolledCountPhrase ?? '—' },
  minStudentsPhrase: { description: 'PL-270: "3 students" / "1 student" — the class minimum (FP push)', resolve: (_c, _a, e) => e.minStudentsPhrase ?? '—' },
  waitlistDepth: { description: 'Waitlist depth (CS class-full)', resolve: (_c, _a, e) => e.waitlistDepth ?? '0' },
  classroomFormLink: {
    description: 'Signed tell-us-the-room form link (CS classroom request)',
    // PL-60 rule: URL variables never fall back to a dead "#".
    resolve: (c, _a, e) => e.classroomFormLink ?? c.portalUrl,
  },
  payPeriodRange: { description: '"September 1 – September 15" (T5)', resolve: (_c, _a, e) => e.payPeriodRange ?? '—' },
  timecardHours: { description: 'Timecard hours, e.g. "14.5" (T5)', resolve: (_c, _a, e) => e.timecardHours ?? '—' },
  timecardLink: {
    description: "Tutor portal timecard link (T5)",
    resolve: (c, _a, e) => e.timecardLink ?? c.portalUrl,
  },
  // PL-111: T6 session-note reminders.
  sessionDate: {
    description: 'T6: the day whose notes are missing, e.g. "Wednesday, July 22"',
    resolve: (_c, _a, e) => e.sessionDate ?? '—',
  },
  missingSessionsBlock: {
    description: 'T6: the list of sessions still missing notes (computed)',
    block: true,
    resolve: (_c, _a, e) => e.missingSessionsBlock ?? '',
  },
  notesLink: {
    description: 'T6: tutor portal session-notes link',
    resolve: (c, _a, e) => e.notesLink ?? c.portalUrl,
  },
  // PL-112: SUB coverage templates.
  coverageSessionBlock: {
    description: 'SUB: the offered session details (computed lines)',
    block: true,
    resolve: (_c, _a, e) => e.coverageSessionBlock ?? '',
  },
  // PL-131: available to every counselor-facing template. The CD digest
  // already carries it inside {digestClassListBlock}; CR/FP can place it
  // wherever Scarlett decides it reads naturally — the value is supplied at
  // send time, so it resolves the moment she adds it to a body.
  counselorRosterLink: {
    description: "Counselor's no-login live-roster link for this class",
    resolve: (c, _a, e) => e.counselorRosterLink ?? c.portalUrl,
  },
  // PL-214: CS class-confirmed welcome + its SA sample-announcement block.
  salesPageLink: {
    description: 'CS/SA: the school sales page (the hgl.co short link) — never the raw register link',
    resolve: (_c, _a, e) => e.salesPageLink ?? '—',
  },
  collateralLanguagesPhrase: {
    description: 'CS: " and language (English and Spanish)" for two-language schools; empty otherwise',
    resolve: (_c, _a, e) => e.collateralLanguagesPhrase ?? '',
  },
  courseDatesPhrase: {
    description: 'SA: "from September 14 to October 1" (computed from the session calendar)',
    resolve: (_c, _a, e) => e.courseDatesPhrase ?? '—',
  },
  enrollmentDeadline: {
    description: 'Enrollment deadline, written out (e.g. "August 22, 2026")',
    resolve: (_c, _a, e) => e.enrollmentDeadline ?? '—',
  },
  classCapacity: {
    description: 'Class capacity (e.g. "15")',
    resolve: (_c, _a, e) => e.classCapacity ?? '—',
  },
  // PL-219 v1.5: post-class survey.
  surveyLink: {
    description: 'SV: the pre-bound per-student survey link',
    resolve: (c, _a, e) => e.surveyLink ?? c.portalUrl,
  },
  surveyReminderLine: {
    description: 'SV: empty on the first ask; the "already did this in class? ignore us" paragraph on the reminder',
    block: true,
    resolve: (_c, _a, e) => e.surveyReminderLine ?? '',
  },
  coverageRespondLink: {
    description: 'SUB: tutor portal link where the candidate answers',
    resolve: (c, _a, e) => e.coverageRespondLink ?? c.portalUrl,
  },
  coverageOutcomeLine: {
    description: 'SUB: one-sentence outcome for the requesting tutor (computed)',
    resolve: (_c, _a, e) => e.coverageOutcomeLine ?? '—',
  },
  // PL-156: the hand-over note between the two tutors.
  coverageNoteBlock: {
    description: "SUB: the requesting tutor's hand-over note, as paragraphs",
    block: true,
    resolve: (_c, _a, e) => e.coverageNoteBlock ?? '',
  },
  coverageNoteFrom: {
    description: 'SUB: name of the tutor who wrote the hand-over note',
    resolve: (_c, _a, e) => e.coverageNoteFrom ?? 'Your colleague',
  },
  coverageNoteButton: {
    description:
      'SUB: "Send X a note" button — present ONLY on the accepted outcome; empty when declined or withdrawn (there is nobody to hand off to)',
    block: true,
    resolve: (_c, _a, e) => e.coverageNoteButton ?? '',
  },
  tutorChangeBlock: { description: 'T3-T: the "what changed" delta list (computed, the whole coalesced batch)', block: true, resolve: (_c, _a, e) => e.tutorChangeBlock ?? '' },
  // PL-81: the coalesced tutor notice's composed pieces.
  scheduleChangeCountPhrase: {
    description: 'T3-T subject lead: "Schedule change" (one) or "3 schedule changes" (batch)',
    resolve: (_c, _a, e) => e.scheduleChangeCountPhrase ?? 'Schedule change',
  },
  tutorScheduleBlock: {
    description: "T3-T: each affected student's current upcoming schedule at send time (computed) — the truth first, deltas after",
    block: true,
    resolve: (_c, _a, e) => e.tutorScheduleBlock ?? '',
  },
  alertStudentName: { description: 'Alerts: student the alert is about', resolve: (_c, _a, e) => e.alertStudentName ?? '—' },
  alertParentName: { description: 'Alerts: parent the alert is about', resolve: (_c, _a, e) => e.alertParentName ?? '—' },
  alertParentEmail: { description: "Alerts: that parent's email", resolve: (_c, _a, e) => e.alertParentEmail ?? '—' },
  alertCounts: { description: 'Alerts: the count string, e.g. "3 enrolled / 8 min / 15 cap"', resolve: (_c, _a, e) => e.alertCounts ?? '—' },
  alertDetailsBlock: {
    description: 'Alerts: the composed data details (framing is editable; these guts stay computed)',
    block: true,
    resolve: (_c, _a, e) => e.alertDetailsBlock ?? '',
  },
  // PL-89: subject-safe date for the missing-details warning.
  classDetailsSendDate: {
    description: "When the families' class-details email (#4) goes out — derived from the sequence, e.g. \"Tuesday, September 1, 2026\"",
    resolve: (_c, _a, e) => e.classDetailsSendDate ?? '—',
  },
  // PL-264: the same fact as a whole tense-aware phrase — "goes out Tuesday,
  // September 1, 2026" before the date, "is overdue (should have gone out
  // Tuesday, September 1, 2026)" after it.
  classDetailsSendPhrase: {
    description: 'PL-264: subject-safe, tense-aware send phrase for the class-details email — "goes out {date}" before the date, "is overdue" after',
    resolve: (_c, _a, e) => e.classDetailsSendPhrase ?? e.classDetailsSendDate ?? '—',
  },
  // PL-262: reschedule-request ack.
  sessionWhenPhrase: {
    description: 'PL-262: the requested session\'s local time, e.g. "Wed, Aug 5, 4:00 PM"',
    resolve: (_c, _a, e) => e.sessionWhenPhrase ?? '—',
  },
  subjectName: {
    description: 'The session\'s subject, e.g. "French"',
    resolve: (_c, _a, e) => e.subjectName ?? 'tutoring',
  },
  lateFeeNoteBlock: {
    description: 'PL-262: the inside-24h $40/hour caveat paragraph — EMPTY when the request came with 24h+ notice',
    block: true,
    resolve: (_c, _a, e) => e.lateFeeNoteBlock ?? '',
  },
  creditAmount: {
    description: 'PL-76: the cancelled class\'s paid amount as tutoring credit, e.g. "$899.00"',
    resolve: (_c, _a, e) => e.creditAmount ?? '—',
  },
  // PL-84: computed by the conversion route from the persisted offer.
  conversionTermsBlock: {
    description:
      'CX-T: the conversion terms — "converts to 8 hours of 1-on-1 tutoring — nothing to pay until those are used" when the cancellation carried an hours offer; dollar-credit wording only as the no-offer fallback',
    block: true,
    resolve: (_c, _a, e) => e.conversionTermsBlock ?? '',
  },
  // --- PL-78: instructor emails ---------------------------------------------
  instructorCountsLine: {
    description: 'Live count, PL-73 format: "6 enrolled / 8 min / 15 cap"',
    resolve: (_c, _a, e) => e.instructorCountsLine ?? '—',
  },
  instructorViewLink: {
    description: "The instructor's class page in the portal",
    resolve: (c, _a, e) => e.instructorViewLink ?? c.portalUrl,
  },
  registrationCloseDate: {
    description: 'When the registration window closes, written out',
    resolve: (_c, _a, e) => e.registrationCloseDate ?? '—',
  },
  digestMilestoneLine: {
    description: 'IN_DIGEST milestone: "" weekly · minimum-met / class-full / registration-closed lines on the instant pings',
    block: true,
    resolve: (_c, _a, e) => e.digestMilestoneLine ?? '',
  },
  // PL-95: reassurance footer, composed per variant like the milestone line.
  digestNextStepsBlock: {
    description: 'IN_DIGEST "what happens from here", per variant: min-met lists the automatic next steps (class-details email + FYI, another ping if it fills, sessions already on the calendar) · class-full / registration-closed / weekly get their own lines',
    block: true,
    resolve: (_c, _a, e) => e.digestNextStepsBlock ?? '',
  },
  // PL-80c: IN_WELCOME's session list gets its OWN variable — {scheduleBlock}
  // is the tutoring list and its sample ("Ana — September sessions") rendered
  // inside the instructor welcome. Distinct name = the collision is
  // impossible, not just re-sampled away.
  classScheduleBlock: {
    description: "IN_WELCOME: the class's full session list (dates, times, room) — computed from the class calendar",
    block: true,
    resolve: (_c, _a, e) => e.classScheduleBlock ?? '',
  },
  fyiOriginalSubject: {
    description: "IN_FYI: the family email's original subject",
    resolve: (_c, _a, e) => e.fyiOriginalSubject ?? '—',
  },
  familyEmailBlock: {
    description: "IN_FYI: the family email's rendered content (computed — exactly what families received)",
    block: true,
    resolve: (_c, _a, e) => e.familyEmailBlock ?? '',
  },
  // PL-335 D: the minimum-enrollment decision note's two composed pieces.
  minDecisionSubject: {
    description: 'IN_MIN_DECISION subject tail: "running as planned" · "registration deadline extended to September 12"',
    resolve: (_c, _a, e) => e.minDecisionSubject ?? '—',
  },
  minDecisionLine: {
    description: 'IN_MIN_DECISION: the decision sentence — run-anyway ("we\'ve decided to run it as planned — the schedule stands") or extend ("we\'ve extended the registration deadline to {date}…"), composed at send time',
    block: true,
    md: true,
    resolve: (_c, _a, e) => e.minDecisionLine ?? '',
  },

  // --- computed blocks ---------------------------------------------------------
  orderSummaryBlock: {
    description: '#0-P/LR order summary (class + add-ons + amount paid) — renders empty on student sends',
    block: true,
    resolve: (c, a) => {
      if (a === 'student') return ''
      const addonLines = c.addons
        .map((a) => `<br/>${a.name} — 1-on-1 Tutoring — $${a.pricePaid}`)
        .join('')
      // PL-75: matches #0-P v4's "Enrollment Confirmed" subject.
      return `<h3 style="color:#334155">Enrollment Summary</h3>
      <p>${c.className} — $${c.price}${addonLines}
      <br/><strong>Amount paid:</strong> ${c.amountPaid != null ? `$${c.amountPaid}` : `$${c.price}`}
      · ${c.paidAt ? fmt(c.paidAt) : ''}</p>`
    },
  },
  registrationDetailsBlock: {
    description: '#0-P/LR registration recap (student, school, accommodations…) — empty on student sends',
    block: true,
    resolve: (c, a) => {
      if (a === 'student') return ''
      const detail = (label: string, value: string | null) =>
        `<br/><strong>${label}:</strong> ${value && value.trim() ? value : '—'}`
      return `<h3 style="color:#334155">Registration Details</h3>
      <p><strong>Student:</strong> ${c.studentFirstName} ${c.studentLastName}
      ${detail('Student email', c.studentEmail)}
      ${detail('School', c.schoolName)}
      ${detail('Graduating year', c.graduatingYear)}
      ${detail('Testing accommodations', c.accommodations)}
      ${detail('Previous test scores', c.previousScores)}
      ${detail('Notes', c.notes)}</p>`
    },
  },
  changesBlock: {
    description: 'SU: only the details that changed (computed at send time)',
    block: true,
    resolve: (_c, _a, e) => e.changesBlock ?? '<p><em>(changes list)</em></p>',
  },
  upsellPackagesBlock: {
    description: '#9: the package CTA buttons with live savings math',
    block: true,
    resolve: (_c, _a, e) => e.upsellPackagesBlock ?? '<p><em>(package buttons)</em></p>',
  },
  classDetailsBlock: {
    description: 'LR: instructor + where-classes-happen sentence, or the not-yet-confirmed fallback',
    block: true,
    // PL-71b: mode-aware via the shared builder; LR keeps the FULL
    // instructor name (first-introduction rule).
    resolve: (c, _a, e) =>
      e.classDetailsBlock ??
      (c.instructorName && c.defaultLocation
        ? `The instructor will be ${c.instructorName}, and classes take place ${classLocationTailHtml(c.defaultLocation, c.deliveryMode)}.`
        : `We'll send classroom and instructor details as soon as they're confirmed.`),
  },
  waitlistPosition: {
    description: 'W1: position in line',
    resolve: (_c, _a, e) => String(e.waitlistPosition ?? '—'),
  },
  claimDeadline: {
    description: 'W2: when the 48h claim window closes',
    resolve: (_c, _a, e) => e.claimDeadline ?? '—',
  },
}

export const KNOWN_VARIABLE_NAMES = Object.keys(VARIABLES)

export function resolveVariables(
  ctx: EnrollmentEmailContext,
  audience: Audience,
  extra: ExtraVars = {}
): ResolvedVars {
  const out: ResolvedVars = {}
  for (const [name, def] of Object.entries(VARIABLES)) {
    out[name] = { value: def.resolve(ctx, audience, extra), block: def.block, md: def.md }
  }
  return out
}

/** Sample data for editor previews and "send test to me" (spec §A4). */
export const SAMPLE_CONTEXT: EnrollmentEmailContext = {
  enrollmentId: '00000000-0000-4000-8000-000000000000',
  classId: '00000000-0000-4000-8000-000000000001',
  timezone: 'America/Denver',
  calendarPageUrl: 'https://hgl-portal.vercel.app/test-link',
  resumePaymentUrl: 'https://hgl-portal.vercel.app/test-link',
  portalUrl: 'https://hgl-portal.vercel.app/portal',
  availabilityUrl: 'https://hgl-portal.vercel.app/test-link',
  diagnosticDueDate: '2026-09-04',
  addons: [{ name: '5-Hour Package', hours: 5, pricePaid: 600 }],
  marketingOptOut: false,
  unsubscribeUrl: 'https://hgl-portal.vercel.app/test-link',
  parentFirstName: 'Alex',
  parentEmail: 'sample-parent@example.com',
  studentFirstName: 'Ana',
  studentLastName: 'García',
  studentPronouns: 'she_her',
  studentEmail: 'sample-student@example.com',
  graduatingYear: '2028',
  accommodations: 'Extended time (approved)',
  previousScores: 'PSAT 1180',
  notes: null,
  amountPaid: 1050,
  paidAt: '2026-08-20T15:00:00Z',
  enrolledAt: '2026-08-20T14:00:00Z',
  schoolName: 'Sample International School',
  schoolNickname: 'SIS',
  classType: 'SAT Prep',
  className: 'SIS SAT Prep',
  classTime: '10:00 AM to 12:00 PM',
  examInfo: { examName: 'SAT', regLabel: 'College Board Website', regUrl: 'https://www.collegeboard.org' },
  instructorName: 'Jordan Rivera',
  instructorBio: null,
  isOpenEnrollment: false,
  hasDiagnostics: true,
  defaultLocation: 'Room 204',
  deliveryMode: 'in_person',
  synapGroup: 'https://hgl.synap.ac/groups/sample',
  startDate: '2026-09-05',
  firstSession: '2026-09-05',
  lastSession: '2026-10-24',
  price: 450,
  // PL-315: realistic sample sessions so {sessionScheduleBlock} previews
  // show the real shape (list + zone line + subscribe link).
  sessions: [
    { id: 'ses-1', session_date: '2026-09-05', start_time: '10:00', end_time: '13:00', location: null },
    { id: 'ses-2', session_date: '2026-09-12', start_time: '10:00', end_time: '13:00', location: null },
    { id: 'ses-3', session_date: '2026-09-19', start_time: '10:00', end_time: '13:00', location: null },
  ],
  // PL-279: FO samples render with a realistic per-cohort offer (the editor
  // preview + view-as sign-off page compose from here).
  followOn: {
    className: 'SAT Math Deep Dive',
    shortName: 'Deep Dive',
    registrationLink: 'https://hgl-portal.vercel.app/register/sat-math-deep-dive-fall26',
    discountAmount: '$50',
    discountCode: 'DEEPDIVE50',
    endDate: 'Saturday, November 7, 2026',
    infoUrl: 'https://hgl.co/advanced-sat',
  },
}

// PL-96: the CX sample is RENDERED FROM the real composer at module load —
// after Scarlett's test-send caught the sample still showing pre-batch-13
// copy (no PL-86 convert button, no savings framing) while real sends were
// fine. Computed, not hand-written: composer and sample can never disagree
// silently again. Standard (no-add-on) parent case, two-option shape
// (hours offer + next-course credit), obviously-test convert href.
const SAMPLE_CX_CTX = {
  enrollmentId: '00000000-0000-4000-8000-000000000000',
  studentFirstName: 'Ana',
  classType: 'SAT Prep',
  schoolNickname: 'SIS',
  className: 'SIS SAT Prep',
  addons: [] as { name: string; hours: number; pricePaid: number }[],
}
// 6 hours at the ~$125 regular rate ≈ $750 → $450 paid = save $300 (40%).
const SAMPLE_CX_OFFER: CancellationOffer = { hours: 6, price: 450, savingsPct: 40, savingsUsd: 300 }
const SAMPLE_CANCELLATION_OPTIONS = cancellationOptionsHtml(
  SAMPLE_CX_CTX,
  'parent',
  SAMPLE_CX_OFFER,
  'January 2027',
  { convertUrl: 'https://hgl-portal.vercel.app/test-link', refundUrl: 'https://hgl-portal.vercel.app/test-link' }
)

// PL-137/PL-157: ONE scenario drives every substitute-coverage sample — the
// AL_* alert pins AND the SUB_* tutor-trio pins below all derive from this
// object through the real composers in coverage-copy.ts. Before PL-157 the
// SUB_COVERAGE_NOTE preview mixed sources: {tutorFirstName} came from the
// shared pool ("Billy") while the pinned {coverageNoteBlock} prose thanked
// Jordan — one person writing to themselves (the PL-80b failure exactly).
// Deriving all of it from one facts object is the PL-80c lesson: make the
// collision structurally impossible, don't re-sample one value.
//
// The scenario: Billy Thomas asked Jordan Lee to cover Ana's SAT Math
// session; Jordan accepted; Billy sends Jordan the hand-over note.
export const SAMPLE_COVERAGE_FACTS = {
  studentName: 'Ana García',
  studentFirst: 'Ana',
  studentId: '00000000-0000-4000-8000-000000000005',
  subjectName: 'SAT Math',
  when: 'Thursday, September 10 at 4:00 PM',
  requesterName: 'Billy Thomas',
  candidateName: 'Jordan Lee',
  baseUrl: 'https://hgl-portal.vercel.app',
}
// First names split exactly the way coverage.ts splits them for real sends.
const COVERAGE_REQUESTER_FIRST = SAMPLE_COVERAGE_FACTS.requesterName.split(' ')[0]
const COVERAGE_CANDIDATE_FIRST = SAMPLE_COVERAGE_FACTS.candidateName.split(' ')[0]
// The note prose is user-authored free text in real sends, so the sample
// prose is hand-written — but every name in it comes from the facts object,
// and the HTML wrapping runs through the real coverageNoteHtml composer.
export const SAMPLE_COVERAGE_NOTE_PROSE = `Thanks so much for taking this one, ${COVERAGE_CANDIDATE_FIRST} — I owe you.

${SAMPLE_COVERAGE_FACTS.studentFirst} is midway through the geometry unit and keeps second-guessing herself on circle theorems; she gets there, she just needs to be told she's right. Her last diagnostic is in the notes. She'll ask to skip the warm-up — it's worth doing anyway.`
const SAMPLE_COVERAGE_SESSION_BLOCK = coverageSessionLines({
  when: SAMPLE_COVERAGE_FACTS.when,
  studentFirst: SAMPLE_COVERAGE_FACTS.studentFirst,
  subjectName: SAMPLE_COVERAGE_FACTS.subjectName,
  location: 'https://meet.google.com/sample-link',
  requesterName: SAMPLE_COVERAGE_FACTS.requesterName,
}).join('\n')
const SAMPLE_COVERAGE_OUTCOME_LINE = coverageOutcomeLine({
  accepted: true,
  candidateName: SAMPLE_COVERAGE_FACTS.candidateName,
  studentFirst: SAMPLE_COVERAGE_FACTS.studentFirst,
  subjectName: SAMPLE_COVERAGE_FACTS.subjectName,
  when: SAMPLE_COVERAGE_FACTS.when,
  contactEmail: 'info@highergroundlearning.com',
})
const SAMPLE_COVERAGE_NOTE_BUTTON = coverageNoteButtonHtml({
  noteUrl: 'https://hgl-portal.vercel.app/test-link',
  subFirstName: COVERAGE_CANDIDATE_FIRST,
  studentFirst: SAMPLE_COVERAGE_FACTS.studentFirst,
})
const SAMPLE_COVERAGE_NOTE_BLOCK = coverageNoteHtml(SAMPLE_COVERAGE_NOTE_PROSE)

// PL-56: previews must read like real sends — placeholder-ish samples
// ("your tutor", "tutoring", "—") impersonated bugs during template review.
// Composed blocks carry worked examples mirroring what the send code
// actually builds; T4's is the attempt-3 (retries exhausted) render — the
// highest-stakes email in the set.
export const SAMPLE_EXTRA: ExtraVars = {
  // PL-219: survey samples.
  surveyLink: 'https://hgl-portal.vercel.app/test-link',
  surveyReminderLine: '',
  // PL-214: CS class-confirmed welcome + SA block samples.
  salesPageLink: 'https://hgl.co/aisj',
  collateralLanguagesPhrase: ' and language (English and Spanish)',
  courseDatesPhrase: 'from September 14 to October 1',
  enrollmentDeadline: 'August 22, 2026',
  classCapacity: '15',
  changesBlock:
    '<p><strong>First day of class:</strong> now Saturday, 12 September 2026<br/><strong>Location:</strong> now Room 301</p>',
  upsellPackagesBlock:
    '<p style="margin:8px 0"><a href="https://hgl-portal.vercel.app/test-link" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none;min-width:260px;text-align:center">5 hours — save $50</a></p><p style="margin:8px 0"><a href="https://hgl-portal.vercel.app/test-link" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none;min-width:260px;text-align:center">10 hours — save $250</a></p><p style="margin:8px 0"><a href="https://hgl-portal.vercel.app/test-link" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none;min-width:260px;text-align:center">15 hours — save $525</a></p>',
  waitlistPosition: 2,
  claimDeadline: 'Thursday, 3 September, 4:00 PM',
  claimLink: 'https://hgl-portal.vercel.app/test-link',
  declineLink: 'https://hgl-portal.vercel.app/test-link',

  // --- tutoring set ---------------------------------------------------------
  tutorName: 'Billy Thomas',
  tutorFirstName: 'Billy',
  tutoringSubject: 'SAT',
  tutoringMonthLabel: 'September 2026',
  // PL-187: the batched-range shape the composer now produces.
  scheduleSummary: 'Mondays from 4:00 – 5:00 PM, starting September 7',
  scheduleZoneNote:
    '<p style="color:#506171;font-size:14px">These times are anchored to Mountain Daylight Time, so your local time may shift by an hour when daylight saving changes on one side and not the other. We&rsquo;ll always show the current time in your calendar invite.</p>',
  scheduleBlock:
    '<p><strong>Ana — September sessions</strong></p><ul><li>Monday, September 7 — 4:00 to 5:00 PM</li><li>Monday, September 14 — 4:00 to 5:00 PM</li><li>Monday, September 21 — 4:00 to 5:00 PM</li><li>Monday, September 28 — 4:00 to 5:00 PM</li></ul>',
  monthTotalLine:
    '<p style="font-size:16px"><strong>Month total: $480.00</strong> — billed once you confirm, due by the end of this month.</p>',
  packageNote: '',
  confirmLink: 'https://hgl-portal.vercel.app/test-link',
  confirmOneTapLink: 'https://hgl-portal.vercel.app/test-link',
  approveLink: 'https://hgl-portal.vercel.app/test-link',
  autoconfirmDays: 5,
  daysLeft: 3,

  // T2 (invoice) — normal issue, autopay not yet on file
  invoiceReminderPrefix: '',
  invoiceTotal: '$480.00',
  invoiceDueDate: 'September 30',
  invoiceUrl: 'https://hgl-portal.vercel.app/test-link',
  invoiceIntroBlock:
    '<p>Your invoice for September 2026 tutoring is ready: <strong>$480.00</strong>, due by <strong>September 30</strong>.</p>',
  autopayBlock:
    '<p style="color:#64748b;font-size:13px">Prefer not to think about this each month? <a href="https://hgl-portal.vercel.app/test-link" style="color:#00AEEE">Set up autopay</a> and future invoices charge your saved card or bank account automatically.</p>',

  // T4 (payment failed) — attempt 3 of 3: retries exhausted, pay-now shown
  paymentFailBlock:
    "<p>The $480.00 charge for September 2026 tutoring didn't go through (attempt 3 of 3).</p><p><strong>We've stopped automatic retries.</strong> You can pay directly, or update your saved payment method:</p>",
  payButtonBlock:
    '<p style="margin:24px 0"><a href="https://hgl-portal.vercel.app/test-link" style="background:#506171;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Pay now</a></p>',

  // T3 (schedule change) — PL-96 sibling sweep: mirrors the REAL parent
  // compose in sendScheduleChangeNotices (subject-first sentence, ul/li
  // markup), not the pre-PL-13 hand-written shape.
  changeListBlock:
    '<ul style="margin:0;padding-left:20px;color:#334155"><li style="margin:2px 0">SAT on Mon, Sep 14, 4:00 PM moved to Wed, Sep 16, 4:00 PM.</li></ul>',

  // CX / CX-W (cancellation) — PL-96: rendered from the real composer above.
  cancellationOptionsBlock: SAMPLE_CANCELLATION_OPTIONS,

  // T7/T8 links + lines
  intakeFormLink: 'https://hgl-portal.vercel.app/test-link',
  agreementsLink: 'https://hgl-portal.vercel.app/test-link',
  autopayLink: 'https://hgl-portal.vercel.app/test-link',
  tutorContactLine:
    '<p><strong>Your tutor: Billy Thomas</strong> — <a href="mailto:billy@highergroundlearning.com" style="color:#00AEEE">billy@highergroundlearning.com</a></p>',
  // PL-234: the sample shows the COMMON case (a real link) — the "tutor
  // sends the meeting link" fallback only renders when no link exists
  // anywhere, so test renders must not imply it's the default.
  locationBlock:
    '<p><strong>Where:</strong> sessions are online — join here each time: <a href="https://hgl-portal.vercel.app/test-link" style="color:#00AEEE">https://hgl-portal.vercel.app/test-link</a></p>',
  schedulePdfLink: 'https://hgl-portal.vercel.app/test-link',
  contactBlock:
    '<p style="margin-top:24px;padding:12px 16px;background:#f1f5f9;border-radius:8px;color:#334155;font-size:14px">Questions, or want to handle this by hand? Email <a href="mailto:info@highergroundlearning.com" style="color:#00AEEE">info@highergroundlearning.com</a> or give us a call at <strong>+1 (505) 555-0100</strong> — replying to this email works too, and we\'ll take care of it for you.</p>',

  // PL-53/54 blocks
  hoursRemaining: '5',
  schedulingCtaBlock:
    '<p><a href="https://hgl-portal.vercel.app/test-link" style="color:#00AEEE">Share your availability</a> and we\'ll propose times that fit your family\'s schedule.</p>',
  classSummaryLine: '<strong>SIS SAT Prep</strong> — starts 5 September 2026',
  registrationLink: 'https://hgl-portal.vercel.app/test-link',

  // --- PL-66: counselor / tutor / alert samples (PL-56 standard: read as a
  // real send, never as a bug) ------------------------------------------------
  counselorFirstName: 'Marisol',
  digestCountSummary: '12 students enrolled',
  digestClassNoun: 'classes',
  digestClassListBlock:
    '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:10px 0"><p style="margin:0 0 4px"><strong>SAT Prep — starts September 5, 2026</strong></p><p style="margin:0;color:#475569">Enrolled: <strong>12 of 15</strong> (2 new since last update) · Waitlist: 1</p><p style="margin:6px 0 0;font-size:13px">Registration link to share: <a href="https://hgl-portal.vercel.app/register/sis-sat-prep-fall26">https://hgl-portal.vercel.app/register/sis-sat-prep-fall26</a></p></div>',
  digestFrequencyBlock:
    '<p style="font-size:13px;color:#64748b">How often do you want these? <a href="https://hgl-portal.vercel.app/test-link" style="color:#64748b">Weekly</a> · <a href="https://hgl-portal.vercel.app/test-link" style="color:#64748b">Every 2 weeks</a> · <a href="https://hgl-portal.vercel.app/test-link" style="color:#64748b">Monthly</a> · <a href="https://hgl-portal.vercel.app/test-link" style="color:#64748b">Pause</a></p>',
  deadlineCountdown: '3 days left',
  spotsLeftPhrase: '3 spots',
  enrolledCountLine: '12 of 15 enrolled',
  enrolledCountPhrase: '12 students',
  minStudentsPhrase: '8 students',
  waitlistDepth: '2',
  classroomFormLink: 'https://hgl-portal.vercel.app/test-link',
  payPeriodRange: 'September 1 – September 15',
  timecardHours: '14.5',
  timecardLink: 'https://hgl-portal.vercel.app/portal?view=tutor',
  sessionDate: 'Wednesday, July 22',
  missingSessionsBlock: '4:00 PM — Ana García\n6:00 PM — Marcus Lee',
  notesLink: 'https://hgl-portal.vercel.app/portal?view=tutor',
  // PL-157: the coverage/handoff values below are the SAME derived constants
  // the SUB_* per-template pins use — shared pool and pins literally cannot
  // disagree about the scenario.
  coverageSessionBlock: SAMPLE_COVERAGE_SESSION_BLOCK,
  counselorRosterLink: 'https://hgl-portal.vercel.app/test-link',
  coverageRespondLink: 'https://hgl-portal.vercel.app/portal?view=tutor',
  coverageOutcomeLine: SAMPLE_COVERAGE_OUTCOME_LINE,
  coverageNoteBlock: SAMPLE_COVERAGE_NOTE_BLOCK,
  coverageNoteFrom: SAMPLE_COVERAGE_FACTS.requesterName,
  coverageNoteButton: SAMPLE_COVERAGE_NOTE_BUTTON,
  tutorChangeBlock:
    "<p>Ana's SAT session on <strong>Mon, Sep 14, 4:00 PM</strong> was rescheduled. Your Google Calendar is already updated.</p>",
  alertStudentName: 'Ana García',
  alertParentName: 'Alex García',
  alertParentEmail: 'sample-parent@example.com',
  alertCounts: '3 enrolled / 8 min / 15 cap',
  alertDetailsBlock:
    '<p><strong>Ana García</strong> registered for <strong>SIS SAT Prep</strong> (Sample International School).</p><p>Add-on purchased: <strong>5-Hour Package (5h)</strong></p><p>SIS SAT Prep: <strong>3 enrolled / 8 min / 15 cap</strong></p>',
  creditAmount: '$899.00',
  // PL-84: sample the hours variant — it's the normal case (dollar credit is
  // the no-offer fallback only).
  conversionTermsBlock:
    '<p>Wonderful — you chose 1-on-1 tutoring for Ana. Your SIS SAT Prep payment converts to <strong>8 hours</strong> of 1-on-1 tutoring — nothing to pay until those are used.</p>',
  // PL-80b: sample the min-met digest variant — the milestone line and the
  // counts must agree (a min-met line over "6 enrolled / 8 min" reads like a
  // bug; real sends compute both live so they can never disagree).
  instructorCountsLine: '8 enrolled / 8 min / 15 cap',
  instructorViewLink: 'https://hgl-portal.vercel.app/portal?view=instructor',
  registrationCloseDate: 'September 4, 2026',
  digestMilestoneLine:
    '<p><strong>🎉 The class just reached its minimum — it officially runs.</strong></p>',
  // PL-80c: class-shaped (mirrors scheduleListHtml — the SIS SAT Prep sample
  // class's Saturday sessions), never the tutoring list.
  classScheduleBlock:
    '<ul style="margin:0;padding-left:20px;color:#334155"><li style="margin:2px 0">Saturday, September 5, 2026 — 10:00–12:00 · Room 204</li><li style="margin:2px 0">Saturday, September 12, 2026 — 10:00–12:00 · Room 204</li><li style="margin:2px 0">Saturday, September 19, 2026 — 10:00–12:00 · Room 204</li><li style="margin:2px 0">Saturday, September 26, 2026 — 10:00–12:00 · Room 204</li><li style="margin:2px 0">Saturday, October 3, 2026 — 10:00–12:00 · Room 204</li><li style="margin:2px 0">Saturday, October 10, 2026 — 10:00–12:00 · Room 204</li><li style="margin:2px 0">Saturday, October 17, 2026 — 10:00–12:00 · Room 204</li><li style="margin:2px 0">Saturday, October 24, 2026 — 10:00–12:00 · Room 204</li></ul>',
  fyiOriginalSubject: 'Classroom location for SIS SAT Prep',
  familyEmailBlock:
    '<p>Hey Alex,</p><p>One last reminder: the first day of class is September 5, 2026 from 10:00 AM to 12:00 PM.</p><p><strong>All classes take place in Room 204</strong></p>',
}

// PL-82: per-template-key sample OVERRIDES, merged over SAMPLE_EXTRA for
// previews and test-sends. The 15 alert templates all share
// {alertDetailsBlock}, so one shared sample made 14 of them preview with the
// new-registration story under an unrelated subject — unreviewable. Each
// override mirrors its template's REAL compose (grep the sendAdminAlert /
// renderRegistered call site named in the comment) per the PL-56 standard:
// a sample must read as a plausible real send, never as a bug. Subject
// variables are covered too ({alertCounts} is a plain number where the real
// subject uses one). Real sends are untouched — they compose live.
// PL-137: coverage-alert samples COMPUTED from the real composer (the PL-96
// drift guard), never hand-written. AL_COVERAGE_REQUEST and
// AL_COVERAGE_RESOLVED both body as {alertDetailsBlock} and had no pin, so
// their test-sends rendered the shared REGISTRATION sample — Scarlett
// reviewed a coverage alert and read "Ana García registered for SIS SAT
// Prep… 3 enrolled / 8 min / 15 cap". Real sends were always correct; only
// the review surface lied.
const sampleCoverage = (event: CoverageEvent) => ({
  alertStudentName: SAMPLE_COVERAGE_FACTS.studentName,
  alertDetailsBlock: coverageAlertDetails({ ...SAMPLE_COVERAGE_FACTS, event }),
})

export const SAMPLE_EXTRA_BY_TEMPLATE: Record<string, ExtraVars> = {
  // PL-335 D: instructor-comms.ts sendMinEnrollmentDecisionNote — sample the
  // run-anyway variant, with counts that AGREE with a below-minimum story
  // (the shared pool's 8/8 min-met line would read like a bug here).
  IN_MIN_DECISION: {
    minDecisionSubject: 'running as planned',
    minDecisionLine:
      "The class is below its enrollment minimum, and we've decided to **run it as planned** — the schedule stands exactly as it is.",
    instructorCountsLine: '3 enrolled / 8 min / 15 cap',
  },

  // coverage.ts opsAlert('requested') — a tutor asking a colleague to cover.
  AL_COVERAGE_REQUEST: sampleCoverage('requested'),
  // coverage.ts opsAlert('accepted') — the ACCEPTED variant is pinned; the
  // declined and withdrawn variants are exercised in the coverage E2E
  // (regress:coverage-samples renders all three off the same composer).
  AL_COVERAGE_RESOLVED: sampleCoverage('accepted'),

  // PL-157: the substitute-coverage tutor trio previews as ONE handoff —
  // Billy Thomas asked, Jordan Lee accepted and covers Ana's session, Billy
  // sends the note. Each pin covers EVERY scenario-bearing variable its
  // template renders — the greeting included — so a shared-pool value can
  // never recombine into "one person writing to themselves" again
  // (regress:alert-pins enforces this).
  // coverage.ts requestCoverage → renderRegistered('SUB_COVERAGE_OFFER'):
  // the recipient is the CANDIDATE being asked.
  SUB_COVERAGE_OFFER: {
    tutorFirstName: COVERAGE_CANDIDATE_FIRST,
    coverageSessionBlock: SAMPLE_COVERAGE_SESSION_BLOCK,
  },
  // coverage.ts respondCoverage → renderRegistered('SUB_COVERAGE_RESULT'):
  // the recipient is the REQUESTING tutor hearing the outcome.
  SUB_COVERAGE_RESULT: {
    tutorFirstName: COVERAGE_REQUESTER_FIRST,
    coverageOutcomeLine: SAMPLE_COVERAGE_OUTCOME_LINE,
    coverageNoteButton: SAMPLE_COVERAGE_NOTE_BUTTON,
  },
  // coverage.ts sendCoverageNote → renderRegistered('SUB_COVERAGE_NOTE'):
  // the recipient is the SUBSTITUTE; the note is FROM the requesting tutor
  // and its prose addresses the substitute by name.
  SUB_COVERAGE_NOTE: {
    tutorFirstName: COVERAGE_CANDIDATE_FIRST,
    coverageNoteFrom: SAMPLE_COVERAGE_FACTS.requesterName,
    coverageNoteBlock: SAMPLE_COVERAGE_NOTE_BLOCK,
  },

  // sweepInstructorNudges (cron/reminders): min met, nobody teaching yet.
  ADMIN_INSTRUCTOR_NUDGE: {
    alertDetailsBlock:
      '<p><strong>SIS SAT Prep</strong> (Sample International School) has <strong>8 paid</strong> enrollments against a minimum of <strong>8</strong> — the class is running, and no instructor is assigned yet.</p><p>First session: <strong>Saturday, September 5, 2026</strong>.</p><p><a href="https://hgl-portal.vercel.app/admin">Open the admin class view</a> and select an instructor from the dropdown — or add a new one — so the class-details email can go out on schedule.</p>',
  },
  // registrationNotificationContent (webhook): the shared sample already IS
  // this alert's story — pinned here so it stays right if the shared one moves.
  AL_REGISTRATION: {
    alertCounts: '3 enrolled / 8 min / 15 cap',
    alertDetailsBlock:
      '<p><strong>Ana García</strong> registered for <strong>SIS SAT Prep</strong> (Sample International School).</p><p>Add-on purchased: <strong>5-Hour Package (5h)</strong></p><p>SIS SAT Prep: <strong>3 enrolled / 8 min / 15 cap</strong></p>',
  },
  // sweepAdminRosterReport (cron/reminders): under-min warning + class card.
  AL_ROSTER_REPORT: {
    alertDetailsBlock:
      '<p><strong style="color:#b45309">⚠ In-person classes under minimum</strong>:</p><ul><li><strong>SIS SAT Prep</strong> — 6 paid / 8 min, starts 2026-09-05</li></ul><p><strong>Enrollment for open classes:</strong></p><div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin:8px 0"><p style="margin:0"><strong>SIS SAT Prep</strong> — starts 2026-09-05 · 6 paid / 1 pending / 0 waitlisted · 8 min / 15 cap · <span style="color:#b45309;font-weight:bold">below minimum — needs 2 more paid</span></p><ul style="margin:6px 0 0"><li>Ana García — Paid <span style="color:#0284c7;font-weight:bold">(new this week)</span></li><li>Sam Lee — Paid</li><li>Maya Ortiz — Pending</li></ul></div>',
  },
  // hold-and-alert (cron/reminders, PL-89 tone): the email is OVERDUE to
  // families — location-blank case per the doc.
  AL_CLASS_DETAILS_HOLD: {
    alertDetailsBlock:
      '<p>The class-details email to your SIS SAT Prep families was due this morning and is being held — <strong>families are waiting on it</strong>. Fill in <strong>location</strong> on the admin page and it releases on the next hourly sweep.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fill in class details</a></p>',
  },
  // blank-details warning (cron/reminders, PL-89 shape): both clocks,
  // conditional bullets with the CR chase status, fill-in button, honest
  // hold explanation.
  AL_MISSING_DETAILS: {
    classDetailsSendDate: 'Tuesday, September 1, 2026',
    classDetailsSendPhrase: 'goes out Tuesday, September 1, 2026',
    alertDetailsBlock:
      '<p><strong>SIS SAT Prep</strong> — first session <strong>Saturday, September 5, 2026</strong> (in 1 week).</p><p>The "class details" email to families goes out <strong>Tuesday, September 1, 2026</strong> (in 3 days), and it can\'t send while these are blank:</p><ul style="margin:0;padding-left:20px;color:#334155"><li style="margin:4px 0"><strong>Location</strong> — blank. Classroom request status: asked the counselor Aug 22, 2026 (opened Aug 22, 2026) · nudged Aug 27, 2026 (not yet opened) · last call not yet sent.</li><li style="margin:4px 0"><strong>Instructor</strong> — blank. Assign one on the class page.</li></ul><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fill in class details</a></p><p>If the room comes through, filling it in releases everything automatically — nothing else to do. If it\'s still blank when the email is due, the send holds and families wait; that\'s the next alert you\'d get.</p>',
  },
  // min-enrollment decision brief (cron/reminders, PL-91 shape): the
  // 3-days-out case with the counselor's final-days push already sent.
  AL_MIN_ENROLLMENT: {
    alertCounts: '6 paid / 8 minimum',
    alertDetailsBlock:
      '<p><strong>6 paid / 8 minimum / 15 cap</strong> · registration closes in 3 days (Tuesday, August 25, 2026) · first session in 2 weeks (Saturday, September 5, 2026).</p><p>Counselor side: the final-days push (the counselor\'s last-call email) was sent Saturday, August 22, 2026.</p><p><strong>Your three moves:</strong></p><ul style="margin:0;padding-left:20px;color:#334155"><li style="margin:6px 0"><strong>Hold</strong> — final-days signups often close the gap; the counselor\'s final-days push is already working that side.</li><li style="margin:6px 0"><strong>Extend the deadline</strong> (commonly a week) — <a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001">set it on the class page</a>. Extending propagates automatically: collateral, the registration page, and the counselor push timing all derive from the class record, and this checkpoint re-arms against the new date (you\'ll get this brief again at new-deadline −3d if still under).</li><li style="margin:6px 0"><strong>Run under minimum, or cancel</strong> — running under is a legitimate call once in a while; <a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001">the cancel flow lives on the class page</a> if it\'s the other way.</li></ul><p>Nothing here is automatic — this brief informs; the decision is yours.</p>',
  },
  // expired-unclaimed variant (cron/reminders, PL-94 cockpit): offer open
  // status + the rescue action row; unopened = the spam-folder tell.
  AL_WAITLIST_ROLLOVER: {
    alertDetailsBlock:
      '<p>Alex (sample-parent@example.com, student Ana García) did not claim their spot within 48 hours. The offer rolls to the next family automatically.</p><p>Offer email: sent Aug 28 — delivered, not yet opened. <strong>The offer was never opened — this expiry may be a spam-folder artifact; consider a call.</strong></p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001&enrollment=00000000-0000-4000-8000-000000000000" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Re-offer the spot</a>&nbsp;&nbsp;<a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001&enrollment=00000000-0000-4000-8000-000000000000" style="display:inline-block;background:#506171;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Add back at #1</a>&nbsp;&nbsp;<a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001&enrollment=00000000-0000-4000-8000-000000000000" style="color:#00AEEE">See the waitlist</a></p><p style="color:#64748b;font-size:13px">All three land on the family\'s row on the class roster — the re-offer and add-back one-clicks are there (over-cap asks first, and is logged).</p>',
  },
  // webhook route (PL-92 shape): consequences ledger + the match cockpit.
  AL_WEBHOOK_FAILURE: {
    alertDetailsBlock:
      '<p>Stripe checkout session <code>cs_test_a1B2c3D4e5F6g7H8</code> completed (payer <strong>sample-parent@example.com</strong>), but the enrollment could not be updated.</p><p>No enrollment matched (enrollment_id=none).</p><p><strong>Because this payment isn\'t matched, none of this has happened yet:</strong> the enrollment still shows unpaid · no confirmation email went to the family · the class email sequence isn\'t scheduled · <strong>payment reminders for this family are NOT suppressed</strong> (they could be dunned despite having paid) · no QuickBooks receipt exists.</p><p><strong>Nothing retries automatically.</strong> Once you match the payment (below), everything above happens on its own — confirmation, sequence, reminder cancellation, QuickBooks — exactly as if the webhook had matched.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin/match-payment?session=cs_test_a1B2c3D4e5F6g7H8&email=sample-parent%40example.com" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Match to an enrollment</a>&nbsp;&nbsp;<a href="https://dashboard.stripe.com/test/payments/pi_3SampleMismatch01" style="color:#00AEEE">Open this payment in Stripe</a></p>',
  },
  // PL-273: the sweep-watch's one-per-outage alert.
  AL_SWEEP_OVERDUE: {
    alertDetailsBlock:
      '<p><strong>The hourly sweep is overdue.</strong> The last completed run finished <strong>128 minutes ago</strong> (8/6/2026, 9:05:00 AM Denver).</p><p>While it\'s down, nothing sends: reminders, counselor nudges, waitlist offers, billing generation, timecard creation — the whole cadence is paused. Nothing is lost — every send is deduped and claims are retry-safe, so the next successful run delivers the backlog.</p><p><strong>To recover:</strong> re-run the sweep manually — GitHub → Actions → "hourly-sweep" → Run workflow (this is exactly what fixed the Aug 6 outage), or ask Code to hit the endpoint. The dashboard\'s health card shows live status.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin" style="display:inline-block;background:#b91c1c;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open the dashboard health card</a></p><p>You\'ll get one email per outage (not one per hour); the next successful sweep notes its own recovery in the dashboard activity feed.</p>',
  },
  // qbo-sync queue (PL-92 shape): fix-and-retry deep-links THIS failed row.
  AL_QBO_FAILURE: {
    alertDetailsBlock:
      '<p>After 5 attempts, the Sales Receipt for Stripe payment <code>pi_3SampleQboFail01</code> (enrollment <code>00000000-0000-4000-8000-000000000000</code>) could not be created in QuickBooks.</p><p>Last error: <code>Business Validation Error: Duplicate Document Number Error : You must specify a different number.</code></p><p>The books are missing this transaction until it\'s fixed and retried.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin?qbo=00000000-0000-4000-8000-000000000004" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fix &amp; retry this sync</a></p><p><a href="https://dashboard.stripe.com/test/payments/pi_3SampleQboFail01" style="color:#00AEEE">The Stripe payment</a> · <a href="https://hgl-portal.vercel.app/admin/communications?enrollment=00000000-0000-4000-8000-000000000000" style="color:#00AEEE">the enrollment record</a></p>',
  },
  // tutoring-billing cycle: {alertCounts} is the WHOLE noun phrase here
  // ("2 tutoring families") — PL-216 moved the noun into the variable so the
  // subject's plural always matches the count ("1 tutoring family"). The
  // shared class-counts ticker must never leak in (the PL-82 bug).
  AL_UNAGREED: {
    alertCounts: '2 tutoring families',
    alertDetailsBlock:
      '<p>The September 2026 cycle just proposed invoices for families with no accepted scheduling &amp; billing agreement on file (invoicing proceeds, but chase these):</p><ul><li><a href="https://hgl-portal.vercel.app/test-link" style="color:#00AEEE">Alex García</a> (sample-parent@example.com)</li><li><a href="https://hgl-portal.vercel.app/test-link" style="color:#00AEEE">Jordan Lee</a> (sample-parent2@example.com)</li></ul><p>Send or re-send agreement links from <a href="https://hgl-portal.vercel.app/test-link" style="color:#00AEEE">the agreements panel</a> — or click a family\'s name above to jump straight to their row.</p>',
  },
  // availability route (PL-92 shape): schedule-now opens the wizard preloaded.
  AL_AVAILABILITY_SHARED: {
    alertDetailsBlock:
      '<p><strong>Alex</strong> (sample-parent@example.com) shared Ana\'s availability.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin/tutoring?schedule=00000000-0000-4000-8000-000000000005" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Schedule Ana now</a></p><p>The wizard opens with Ana preselected and the just-shared windows loaded · <a href="https://hgl-portal.vercel.app/admin/tutoring?family=00000000-0000-4000-8000-000000000003" style="color:#00AEEE">the family record</a> shows the shared windows.</p>',
  },
  // PL-174: leads route assignment notify — COMPUTED from the real composer
  // (lead-assign-copy.ts), per the PL-137 rule. PL-196: the actor samples as
  // a NAME — the route resolves the display name, so the preview must too.
  AL_LEAD_ASSIGNED: {
    alertStudentName: 'Ana García',
    alertDetailsBlock: leadAssignedDetails({
      actorName: 'Scarlett Thomas',
      leadName: 'Ana García',
      contactName: 'Alex García',
      contactEmail: 'sample-parent@example.com',
      interest: 'test prep, SAT',
      statusLabel: 'Contacted',
      ageDays: 3,
      leadUrl: 'https://hgl-portal.vercel.app/test-link',
    }),
  },

  // intake route (PL-97 shape): lead record deep-link + schedule-now button.
  AL_INTAKE_COMPLETE: {
    alertDetailsBlock:
      '<p><strong>Alex García</strong> (sample-parent@example.com) completed the intake form for <strong>Ana García</strong> (test prep).</p><p>Availability and all answers are on the lead record, ready for matching.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/test-link" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Schedule Ana now</a>&nbsp;&nbsp;<a href="https://hgl-portal.vercel.app/test-link" style="display:inline-block;background:#506171;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open the lead record</a></p>',
  },
  // tutoring-stripe dunning (PL-90 shape): one charge, three attempts, and
  // the emailed invoice link was the LAST automatic step.
  AL_DUNNING_EXHAUSTED: {
    alertParentName: 'Alex García',
    alertDetailsBlock:
      "<p>Autopay for <strong>Alex García's September 2026 tutoring invoice ($480.00)</strong> failed on the <strong>3rd and final attempt</strong> — one charge, retried automatically 3 times. Last error: <code>Your card was declined.</code></p><p>The family has already been emailed their invoice link to pay by card manually; that was the last automatic step, and <strong>nothing will retry from here</strong>.</p><p>If it stays unpaid, it's a personal follow-up: <a href=\"https://hgl-portal.vercel.app/admin/tutoring?invoice=00000000-0000-4000-8000-000000000002\">the invoice</a> · <a href=\"https://hgl-portal.vercel.app/admin/tutoring?family=00000000-0000-4000-8000-000000000003\">Alex's family record</a></p>",
  },
  // sweepCollections 10-day (PL-92 shape): recap shows delivered-and-opened
  // — the realistic 10-day texture.
  AL_OVERDUE_10: {
    alertDetailsBlock:
      '<p><strong>Alex García — September 2026 tutoring invoice: $480.00</strong>, due <strong>September 30</strong> (10 days past due).</p><p>Already handled automatically: invoice sent Sep 21 — delivered, opened Sep 21 · past-due reminder sent to the family just now.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin/tutoring?family=00000000-0000-4000-8000-000000000003" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">See Alex\'s recent activity</a></p><p><a href="https://hgl-portal.vercel.app/admin/tutoring?invoice=00000000-0000-4000-8000-000000000002" style="color:#00AEEE">Re-send the invoice reminder now</a> — the send-now control on the invoice row (logged as sent-by-hand on the family timeline).</p><p>Nothing else happens automatically until the <strong>30-day mark</strong>, which adds the late-fee flag — that alert is where you decide.</p>',
  },
  // sweepCollections 30-day (PL-92 shape): led by the decision; recap shows
  // delivered-not-opened — the realistic escalation texture.
  AL_OVERDUE_30: {
    alertDetailsBlock:
      '<p><strong>The late-fee flag is now on the table — waive it, apply it, or make it a phone call.</strong></p><p><strong>Alex García — September 2026 tutoring invoice: $480.00</strong>, due September 30 (30+ days past due). Per the signed policy you MAY apply the 10% late fee — never automatic — and consider pausing the schedule.</p><p>Already handled automatically: invoice sent Sep 21 — delivered, not yet opened · 10-day reminder sent Oct 10 — delivered, not yet opened. Nothing further happens automatically.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin/tutoring?invoice=00000000-0000-4000-8000-000000000002" style="display:inline-block;background:#506171;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Apply the 10% late fee</a>&nbsp;&nbsp;<a href="https://hgl-portal.vercel.app/admin/tutoring?family=00000000-0000-4000-8000-000000000003" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">See Alex\'s recent activity</a></p><p><a href="mailto:sample-parent@example.com?subject=Your%20September%202026%20HGL%20tutoring%20invoice" style="color:#00AEEE">Send a manual email</a> — opens pre-addressed to the family.</p>',
  },
  // PL-81 coalesced tutor notice: a two-change batch with the current
  // schedule leading — mirrors composeTutorNotice in tutor-notices.ts.
  T3_TUTOR_NOTICE: {
    scheduleChangeCountPhrase: '2 schedule changes',
    studentNames: 'Ana',
    // PL-299: block-confirmation samples.
    blockHoursLeft: '3',
    blockHours: '15',
    tutoringHourlyRate: '$105',
    studentTutorName: 'Jordan Rivera',
    tutoringSubject: 'SAT',
    tutorScheduleBlock:
      '<h3 style="color:#334155;margin:18px 0 6px">Ana — SAT · upcoming sessions</h3><ul style="margin:0;padding-left:20px;color:#334155"><li style="margin:2px 0">Wed, Sep 16 · 4:00 PM–5:00 PM</li><li style="margin:2px 0">Mon, Sep 21 · 4:00 PM–5:00 PM</li><li style="margin:2px 0">Mon, Sep 28 · 4:00 PM–5:00 PM</li></ul>',
    tutorChangeBlock:
      '<p style="margin:16px 0 6px"><strong>What changed:</strong></p><ul style="margin:0;padding-left:20px;color:#334155"><li style="margin:2px 0">Ana\'s SAT session on <strong>Mon, Sep 14, 4:00 PM</strong> moved to <strong>Wed, Sep 16, 4:00 PM</strong>.</li><li style="margin:2px 0">Ana\'s SAT session on <strong>Mon, Sep 7, 4:00 PM</strong> was cancelled — you\'re still paid for the reserved slot (it stays on your calendar, XCL-marked).</li></ul>',
  },
  // PL-82 sanity pass on other shared block samples: {classSummaryLine} is
  // shared by NW (admin-format date) and the IN_ set (instructor-comms
  // composes formatDateFull + delivery mode) — same class, same story, but
  // pin the IN shape so each previews exactly like its own compose.
  IN_WELCOME: {
    classSummaryLine: '<strong>SIS SAT Prep</strong> — starts Saturday, September 5, 2026, in person at SIS (Sample International School)',
  },
  IN_DIGEST: {
    classSummaryLine: '<strong>SIS SAT Prep</strong> — starts Saturday, September 5, 2026, in person at SIS (Sample International School)',
    // PL-95: the sample IS the min-met variant (milestone + 8/8 counts), so
    // its footer is the min-met one — all three pieces tell one story.
    digestNextStepsBlock:
      "<p style=\"color:#64748b;font-size:13px;margin-top:16px\">Nothing you need to do. From here, automatically: families get the class-details email on Tuesday, September 1, 2026 — you'll receive an FYI copy · registration stays open through Friday, September 4, 2026, and you'll get another ping if the class fills · the sessions are already on your calendar.</p>",
  },
  IN_FYI: {
    classSummaryLine: '<strong>SIS SAT Prep</strong> — starts Saturday, September 5, 2026, in person at SIS (Sample International School)',
  },
}

/** The editor/test-send sample set for one template: shared samples with the
 *  template's own overrides merged on top (PL-82). */
export function sampleExtraFor(templateKey: string | null | undefined): ExtraVars {
  if (!templateKey) return SAMPLE_EXTRA
  const override = SAMPLE_EXTRA_BY_TEMPLATE[templateKey]
  return override ? { ...SAMPLE_EXTRA, ...override } : SAMPLE_EXTRA
}
