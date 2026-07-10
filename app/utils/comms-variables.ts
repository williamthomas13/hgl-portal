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
  /** LR: "instructor + room" sentence (or the not-confirmed fallback). */
  classDetailsBlock?: string
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

function synapUrlValue(ctx: EnrollmentEmailContext): string {
  const v = ctx.synapGroup
  if (!v) return '#'
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

export const VARIABLES: Record<string, VariableDef> = {
  // --- people ---------------------------------------------------------------
  parentFirstName: { description: "Parent's first name", resolve: (c) => c.parentFirstName },
  studentFirstName: { description: "Student's first name", resolve: (c) => c.studentFirstName },
  studentLastName: { description: "Student's last name", resolve: (c) => c.studentLastName },
  studentEmail: { description: "Student's email (— when blank)", resolve: (c) => c.studentEmail ?? '—' },
  recipientFirstName: {
    description: 'Parent name on the parent send, student name on the student send',
    resolve: (c, a) => (a === 'student' ? c.studentFirstName : c.parentFirstName),
  },
  instructorName: {
    description: 'Instructor (or "to be announced")',
    resolve: (c) => c.instructorName ?? 'to be announced',
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

  // --- computed blocks ---------------------------------------------------------
  orderSummaryBlock: {
    description: '#0-P/LR order summary (class + add-ons + amount paid) — renders empty on student sends',
    block: true,
    resolve: (c, a) => {
      if (a === 'student') return ''
      const addonLines = c.addons
        .map((a) => `<br/>${a.name} — 1-on-1 Tutoring — $${a.pricePaid}`)
        .join('')
      return `<h3 style="color:#334155">Order Summary</h3>
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
    description: 'LR: instructor + room sentence, or the not-yet-confirmed fallback',
    block: true,
    resolve: (c, _a, e) =>
      e.classDetailsBlock ??
      (c.instructorName && c.defaultLocation
        ? `The instructor will be ${c.instructorName}, and classes take place at ${classroomValue(c)}.`
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
  calendarPageUrl: 'https://hgl-portal.vercel.app/classes/sample/calendar',
  resumePaymentUrl: 'https://hgl-portal.vercel.app/api/resume-payment?e=sample',
  portalUrl: 'https://hgl-portal.vercel.app/portal',
  diagnosticDueDate: '2026-09-04',
  addons: [{ name: '5-Hour Package', hours: 5, pricePaid: 600 }],
  marketingOptOut: false,
  unsubscribeUrl: 'https://hgl-portal.vercel.app/api/unsubscribe?f=sample',
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

export const SAMPLE_EXTRA: ExtraVars = {
  changesBlock:
    '<p><strong>First day of class:</strong> now Saturday, 12 September 2026<br/><strong>Location:</strong> now Room 301</p>',
  upsellPackagesBlock:
    '<p style="margin:8px 0"><a href="#" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none;min-width:260px;text-align:center">5 hours — save $150</a></p>',
  waitlistPosition: 2,
  claimDeadline: 'Thursday, 3 September, 4:00 PM',
  claimLink: 'https://hgl-portal.vercel.app/api/waitlist/claim?e=sample',
}
