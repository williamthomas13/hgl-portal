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
  /** Tutor-facing schedule-change sentence (pre-rendered). */
  tutorChangeBlock?: string
  /** Internal alerts: who/what the alert is about. */
  alertStudentName?: string
  alertParentName?: string
  alertParentEmail?: string
  /** e.g. "3 enrolled / 8 min / 15 cap" or "4 paid / 8 minimum". */
  alertCounts?: string
  /** The alert's composed data guts (pre-rendered HTML) — framing copy is
   *  editable in the template; the computed details ride this block. */
  alertDetailsBlock?: string
}

type Resolver = (ctx: EnrollmentEmailContext, audience: Audience, extra: ExtraVars) => string

type VariableDef = {
  description: string
  block?: boolean
  resolve: Resolver
}

const s = (ctx: EnrollmentEmailContext) => ctx.studentFirstName

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
      const poss = a === 'student' ? 'your' : 'their'
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
  you_or_they: { description: '"you" ↔ "they"', resolve: (_c, a) => (a === 'student' ? 'you' : 'they') },
  your_or_their: { description: '"your" ↔ "their"', resolve: (_c, a) => (a === 'student' ? 'your' : 'their') },
  youre_or_name_is: {
    description: `"You're" ↔ "Ana is"`,
    resolve: (c, a) => (a === 'student' ? "You're" : `${s(c)} is`),
  },
  you_have_or_name_has: {
    description: '"you have" ↔ "Ana has"',
    resolve: (c, a) => (a === 'student' ? 'you have' : `${s(c)} has`),
  },
  you_have_or_they_have: {
    description: '"you have" ↔ "they have" (when the student was already named)',
    resolve: (_c, a) => (a === 'student' ? 'you have' : 'they have'),
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
    resolve: (c) => c.availabilityUrl,
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
  tutorChangeBlock: { description: 'Tutor-facing schedule-change sentence', block: true, resolve: (_c, _a, e) => e.tutorChangeBlock ?? '' },
  alertStudentName: { description: 'Alerts: student the alert is about', resolve: (_c, _a, e) => e.alertStudentName ?? '—' },
  alertParentName: { description: 'Alerts: parent the alert is about', resolve: (_c, _a, e) => e.alertParentName ?? '—' },
  alertParentEmail: { description: "Alerts: that parent's email", resolve: (_c, _a, e) => e.alertParentEmail ?? '—' },
  alertCounts: { description: 'Alerts: the count string, e.g. "3 enrolled / 8 min / 15 cap"', resolve: (_c, _a, e) => e.alertCounts ?? '—' },
  alertDetailsBlock: {
    description: 'Alerts: the composed data details (framing is editable; these guts stay computed)',
    block: true,
    resolve: (_c, _a, e) => e.alertDetailsBlock ?? '',
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
}
