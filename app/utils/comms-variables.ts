import type { EnrollmentEmailContext, Audience } from './email'
import { formatDateFull } from './dates'
import type { ResolvedVars } from './comms-md'

// Feature A4 variable registry (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A4):
// the ONLY variables template bodies may use. Pronoun-conditional copy is
// expressed as paired variables (never raw conditionals) so the editor stays
// safe for non-developers. Block variables carry pre-rendered HTML and must
// stand alone as a paragraph.

const fmt = (iso: string | null | undefined) => (iso ? formatDateFull(iso.slice(0, 10)) : '—')

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
  /** Tutor's full name / first name (T8, PL-40/41). */
  tutorName?: string
  tutorFirstName?: string
  /** T8: subject name, e.g. "SAT". */
  tutoringSubject?: string
  /** Pre-rendered per-student schedule lists (T1) or first-sessions block (T8). */
  scheduleBlock?: string
  /** PL-40/41: plain-English weekly summary, e.g. "Mondays at 4:00 PM…". */
  scheduleSummary?: string
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
  /** Waitlist depth as text, e.g. "2" (CS class-full). */
  waitlistDepth?: string
  /** Signed tell-us-the-room form link (CS classroom request). */
  classroomFormLink?: string
  /** "September 1 – September 15" (T5 timecard). */
  payPeriodRange?: string
  /** "14.5" (T5 timecard hours). */
  timecardHours?: string
  /** Tutor portal timecard link. */
  timecardLink?: string
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
  /** PL-80c: IN_WELCOME's class-session list — renamed from {scheduleBlock}
   *  so it can never collide with the tutoring sample again. */
  classScheduleBlock?: string
  /** IN_FYI: the family email's original subject. */
  fyiOriginalSubject?: string
  /** IN_FYI: the family email's rendered body (extracted, pre-wrapped HTML). */
  familyEmailBlock?: string
}

type Resolver = (ctx: EnrollmentEmailContext, audience: Audience, extra: ExtraVars) => string

type VariableDef = {
  description: string
  block?: boolean
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
      return { subj: 'she', obj: 'her', poss: 'her', have: 'has', need: 'needs', dont: "doesn't" }
    case 'he_him':
      return { subj: 'he', obj: 'him', poss: 'his', have: 'has', need: 'needs', dont: "doesn't" }
    case 'name_only':
      return {
        subj: ctx.studentFirstName,
        obj: ctx.studentFirstName,
        poss: `${ctx.studentFirstName}'s`,
        have: 'has',
        need: 'needs',
        dont: "doesn't",
      }
    default:
      return { subj: 'they', obj: 'them', poss: 'their', have: 'have', need: 'need', dont: "don't" }
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
    description: 'When a pending registration expires (7 days after signup)',
    resolve: (c) =>
      new Date(new Date(c.enrolledAt).getTime() + 168 * 3_600_000).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
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
      return `<p><strong>Your 1-on-1 tutoring hours.</strong> Your registration includes ${hours} hours of 1-on-1 tutoring. In our experience they're most valuable <em>after</em> the class ends — that's when a tutor can zero in on exactly what your student needs next. When the class wraps up, we'll reach out to get ${c.studentFirstName} scheduled. Want to start earlier instead? <a href="${c.availabilityUrl}" style="color:#00AEEE">Share your availability</a> and we'll propose times. Not sure yet? No problem — we'll ask again once the class is done.</p>`
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
  digestClassListBlock: { description: 'CS digest per-class cards', block: true, resolve: (_c, _a, e) => e.digestClassListBlock ?? '' },
  digestFrequencyBlock: { description: 'CS digest frequency-choice links', block: true, resolve: (_c, _a, e) => e.digestFrequencyBlock ?? '' },
  deadlineCountdown: { description: '"3 days left" / "Last day" (CS push subject)', resolve: (_c, _a, e) => e.deadlineCountdown ?? '—' },
  spotsLeftPhrase: { description: '"3 spots" (CS push)', resolve: (_c, _a, e) => e.spotsLeftPhrase ?? '—' },
  enrolledCountLine: { description: '"12 of 15 enrolled" (CS push)', resolve: (_c, _a, e) => e.enrolledCountLine ?? '—' },
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
    out[name] = { value: def.resolve(ctx, audience, extra), block: def.block }
  }
  return out
}

/** Sample data for editor previews and "send test to me" (spec §A4). */
export const SAMPLE_CONTEXT: EnrollmentEmailContext = {
  enrollmentId: '00000000-0000-4000-8000-000000000000',
  classId: '00000000-0000-4000-8000-000000000001',
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
  defaultLocation: 'Room 204',
  deliveryMode: 'in_person',
  synapGroup: 'https://hgl.synap.ac/groups/sample',
  startDate: '2026-09-05',
  firstSession: '2026-09-05',
  lastSession: '2026-10-24',
  price: 450,
  sessions: [],
}

// PL-56: previews must read like real sends — placeholder-ish samples
// ("your tutor", "tutoring", "—") impersonated bugs during template review.
// Composed blocks carry worked examples mirroring what the send code
// actually builds; T4's is the attempt-3 (retries exhausted) render — the
// highest-stakes email in the set.
export const SAMPLE_EXTRA: ExtraVars = {
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
  scheduleSummary: 'Mondays at 4:00 PM, starting September 7 — one hour each week',
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

  // T3 (schedule change)
  changeListBlock:
    '<p><strong>Monday, September 14</strong> — was 4:00 PM, now <strong>5:30 PM</strong><br/><strong>Monday, September 21</strong> — cancelled (make-up added Wednesday, September 23 at 4:00 PM)</p>',

  // CX / CX-W (cancellation) — worked options list
  cancellationOptionsBlock:
    "<p>Here are your options:</p><ol><li><strong>Convert to 1-on-1 tutoring.</strong> Ana would receive 6 hours of 1-on-1 SAT tutoring — the $450 you paid carries over in full.</li><li><strong>Full refund.</strong> We'll return the full $450 to your original payment method — just reply and we'll take care of it.</li></ol>",

  // T7/T8 links + lines
  intakeFormLink: 'https://hgl-portal.vercel.app/test-link',
  agreementsLink: 'https://hgl-portal.vercel.app/test-link',
  autopayLink: 'https://hgl-portal.vercel.app/test-link',
  tutorContactLine:
    '<p><strong>Your tutor: Billy Thomas</strong> — <a href="mailto:billy@highergroundlearning.com" style="color:#00AEEE">billy@highergroundlearning.com</a></p>',
  locationBlock:
    '<p>Sessions happen online — Billy sends the meeting link before each session.</p>',
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
  digestClassListBlock:
    '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:10px 0"><p style="margin:0 0 4px"><strong>SAT Prep — starts September 5, 2026</strong></p><p style="margin:0;color:#475569">Enrolled: <strong>12 of 15</strong> (2 new since last update) · Waitlist: 1</p><p style="margin:6px 0 0;font-size:13px">Registration link to share: <a href="https://hgl-portal.vercel.app/register/sis-sat-prep-fall26">https://hgl-portal.vercel.app/register/sis-sat-prep-fall26</a></p></div>',
  digestFrequencyBlock:
    '<p style="font-size:13px;color:#64748b">How often do you want these? <a href="https://hgl-portal.vercel.app/test-link" style="color:#64748b">Weekly</a> · <a href="https://hgl-portal.vercel.app/test-link" style="color:#64748b">Every 2 weeks</a> · <a href="https://hgl-portal.vercel.app/test-link" style="color:#64748b">Monthly</a> · <a href="https://hgl-portal.vercel.app/test-link" style="color:#64748b">Pause</a></p>',
  deadlineCountdown: '3 days left',
  spotsLeftPhrase: '3 spots',
  enrolledCountLine: '12 of 15 enrolled',
  waitlistDepth: '2',
  classroomFormLink: 'https://hgl-portal.vercel.app/test-link',
  payPeriodRange: 'September 1 – September 15',
  timecardHours: '14.5',
  timecardLink: 'https://hgl-portal.vercel.app/portal?view=tutor',
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
export const SAMPLE_EXTRA_BY_TEMPLATE: Record<string, ExtraVars> = {
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
      '<p><strong style="color:#b45309">⚠ In-person classes under minimum</strong> (travel booking waits on these):</p><ul><li><strong>SIS SAT Prep</strong> — 6 paid / 8 min, starts 2026-09-05</li></ul><p><strong>Open classes — full rosters:</strong></p><div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin:8px 0"><p style="margin:0"><strong>SIS SAT Prep</strong> — starts 2026-09-05 · 6 paid / 1 pending / 0 waitlisted · 8 min / 15 cap · <span style="color:#b45309;font-weight:bold">below minimum — needs 2 more paid</span></p><ul style="margin:6px 0 0"><li>Ana García — Paid <span style="color:#0284c7;font-weight:bold">(new this week)</span></li><li>Sam Lee — Paid</li><li>Maya Ortiz — Pending</li></ul></div>',
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
    alertDetailsBlock:
      '<p><strong>SIS SAT Prep</strong> — first session <strong>Saturday, September 5, 2026</strong> (in 1 week).</p><p>The "class details" email to families goes out <strong>Tuesday, September 1, 2026</strong> (in 3 days), and it can\'t send while these are blank:</p><ul style="margin:0;padding-left:20px;color:#334155"><li style="margin:4px 0"><strong>Location</strong> — blank. Classroom request status: asked the counselor Aug 22, 2026 (opened Aug 22, 2026) · nudged Aug 27, 2026 (not yet opened) · last call not yet sent.</li><li style="margin:4px 0"><strong>Instructor</strong> — blank. Assign one on the class page.</li></ul><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fill in class details</a></p><p>If the room comes through, filling it in releases everything automatically — nothing else to do. If it\'s still blank when the email is due, the send holds and families wait; that\'s the next alert you\'d get.</p>',
  },
  // min-enrollment decision brief (cron/reminders, PL-91 shape): the
  // 3-days-out case with the FP push already sent.
  AL_MIN_ENROLLMENT: {
    alertCounts: '6 paid / 8 minimum',
    alertDetailsBlock:
      '<p><strong>6 paid / 8 minimum / 15 cap</strong> · registration closes in 3 days (Tuesday, August 25, 2026) · first session in 2 weeks (Saturday, September 5, 2026).</p><p>Counselor side: FP last-call sent Saturday, August 22, 2026.</p><p><strong>Your three moves:</strong></p><ul style="margin:0;padding-left:20px;color:#334155"><li style="margin:6px 0"><strong>Hold</strong> — final-days signups often close the gap; the FP push is already working the counselor side.</li><li style="margin:6px 0"><strong>Extend the deadline</strong> (commonly a week) — <a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001">set it on the class page</a>. Extending propagates automatically: collateral, the registration page, and the counselor push timing all derive from the class record, and this checkpoint re-arms against the new date (you\'ll get this brief again at new-deadline −3d if still under).</li><li style="margin:6px 0"><strong>Run under minimum, or cancel</strong> — running under is a legitimate call once in a while; <a href="https://hgl-portal.vercel.app/admin?class=00000000-0000-4000-8000-000000000001">the cancel flow lives on the class page</a> if it\'s the other way.</li></ul><p>Nothing here is automatic — this brief informs; the decision is yours.</p>',
  },
  // expired-unclaimed variant (cron/reminders) — matches the seed subject.
  AL_WAITLIST_ROLLOVER: {
    alertDetailsBlock:
      '<p>Alex (sample-parent@example.com, student Ana García) did not claim their spot within 48 hours. The offer rolls to the next family automatically.</p>',
  },
  // webhook route (PL-92 shape): consequences ledger + the match cockpit.
  AL_WEBHOOK_FAILURE: {
    alertDetailsBlock:
      '<p>Stripe checkout session <code>cs_test_a1B2c3D4e5F6g7H8</code> completed (payer <strong>sample-parent@example.com</strong>), but the enrollment could not be updated.</p><p>No enrollment matched (enrollment_id=none).</p><p><strong>Because this payment isn\'t matched, none of this has happened yet:</strong> the enrollment still shows unpaid · no confirmation email went to the family · the class email sequence isn\'t scheduled · <strong>payment reminders for this family are NOT suppressed</strong> (they could be dunned despite having paid) · no QuickBooks receipt exists.</p><p><strong>Nothing retries automatically.</strong> Once you match the payment (below), everything above happens on its own — confirmation, sequence, reminder cancellation, QuickBooks — exactly as if the webhook had matched.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin/match-payment?session=cs_test_a1B2c3D4e5F6g7H8&email=sample-parent%40example.com" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Match to an enrollment</a>&nbsp;&nbsp;<a href="https://dashboard.stripe.com/test/payments/pi_3SampleMismatch01" style="color:#00AEEE">Open this payment in Stripe</a></p>',
  },
  // qbo-sync queue (PL-92 shape): fix-and-retry deep-links THIS failed row.
  AL_QBO_FAILURE: {
    alertDetailsBlock:
      '<p>After 5 attempts, the Sales Receipt for Stripe payment <code>pi_3SampleQboFail01</code> (enrollment <code>00000000-0000-4000-8000-000000000000</code>) could not be created in QuickBooks.</p><p>Last error: <code>Business Validation Error: Duplicate Document Number Error : You must specify a different number.</code></p><p>The books are missing this transaction until it\'s fixed and retried.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin?qbo=00000000-0000-4000-8000-000000000004" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Fix &amp; retry this sync</a></p><p><a href="https://dashboard.stripe.com/test/payments/pi_3SampleQboFail01" style="color:#00AEEE">The Stripe payment</a> · <a href="https://hgl-portal.vercel.app/admin/communications?enrollment=00000000-0000-4000-8000-000000000000" style="color:#00AEEE">the enrollment record</a></p>',
  },
  // tutoring-billing cycle: {alertCounts} is a PLAIN NUMBER in this subject —
  // the shared class-counts ticker read "3 enrolled / 8 min / 15 cap tutoring
  // families billed…", which is the exact bug PL-82 exists to kill.
  AL_UNAGREED: {
    alertCounts: '2',
    alertDetailsBlock:
      '<p>The September 2026 cycle just proposed invoices for families with no accepted scheduling &amp; billing agreement on file (invoicing proceeds, but chase these):</p><ul><li>Alex García (sample-parent@example.com)</li><li>Jordan Lee (sample-parent2@example.com)</li></ul><p>Send or re-send agreement links from <strong>/admin/agreements</strong>.</p>',
  },
  // availability route (PL-92 shape): schedule-now opens the wizard preloaded.
  AL_AVAILABILITY_SHARED: {
    alertDetailsBlock:
      '<p><strong>Alex</strong> (sample-parent@example.com) shared Ana\'s availability.</p><p style="margin:20px 0"><a href="https://hgl-portal.vercel.app/admin/tutoring?schedule=00000000-0000-4000-8000-000000000005" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Schedule Ana now</a></p><p>The wizard opens with Ana preselected and the just-shared windows loaded · <a href="https://hgl-portal.vercel.app/admin/tutoring?family=00000000-0000-4000-8000-000000000003" style="color:#00AEEE">the family record</a> shows the shared windows.</p>',
  },
  // intake route: lead finished the form.
  AL_INTAKE_COMPLETE: {
    alertDetailsBlock:
      '<p><strong>Alex García</strong> (sample-parent@example.com) completed the intake form for <strong>Ana García</strong> (test prep).</p><p>The lead is marked intake-complete on /admin/leads — availability and all answers are on the lead record, ready for matching.</p>',
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
