import type { EnrollmentEmailContext, Rendered } from './email'
import { renderEmail, type RenderedWithVersion } from './comms-db-render'
import type { ExtraVars } from './comms-variables'

// PL-13: registry rendering for emails that have no class enrollment behind
// them (the tutoring T-series and their PL-40/41 siblings). The A4 render
// path wants an EnrollmentEmailContext, so these sends pass a STUB context
// carrying the fields their templates actually use (names, portal/calendar
// links) with benign placeholders everywhere else; the tutoring-specific
// variables resolve from ExtraVars. Same live-flag ramp as every template:
// code copy sends until the template is flipped live in the editor.

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export type TutoringStub = {
  parentFirstName: string
  parentEmail?: string
  studentFirstName?: string
  studentLastName?: string
  /** What {calendarLink} should resolve to for this email (e.g. the family
   *  ICS landing) — defaults to the parent portal. */
  calendarPageUrl?: string
}

export function tutoringStubContext(stub: TutoringStub): EnrollmentEmailContext {
  const base = appUrl()
  return {
    enrollmentId: '00000000-0000-4000-8000-000000000013',
    classId: '00000000-0000-4000-8000-000000000113',
    calendarPageUrl: stub.calendarPageUrl ?? `${base}/portal`,
    resumePaymentUrl: `${base}/portal`,
    portalUrl: `${base}/portal`,
    diagnosticDueDate: new Date().toISOString().slice(0, 10),
    addons: [],
    marketingOptOut: false,
    unsubscribeUrl: `${base}/api/unsubscribe`,
    parentFirstName: stub.parentFirstName,
    parentEmail: stub.parentEmail ?? '',
    studentFirstName: stub.studentFirstName ?? 'your student',
    studentLastName: stub.studentLastName ?? '',
    studentEmail: null,
    graduatingYear: null,
    accommodations: null,
    previousScores: null,
    notes: null,
    amountPaid: null,
    paidAt: null,
    enrolledAt: new Date().toISOString(),
    schoolName: 'Higher Ground Learning',
    schoolNickname: 'HGL',
    classType: '1-on-1 Tutoring',
    className: 'HGL 1-on-1 Tutoring',
    classTime: null,
    examInfo: null,
    instructorName: null,
    defaultLocation: null,
    deliveryMode: 'online',
    synapGroup: null,
    startDate: new Date().toISOString().slice(0, 10),
    firstSession: new Date().toISOString().slice(0, 10),
    lastSession: new Date().toISOString().slice(0, 10),
    price: 0,
    sessions: [],
  }
}

/** DB template when live, code fallback otherwise — parent audience. */
export function renderRegistered(
  templateKey: string,
  stub: TutoringStub,
  extra: ExtraVars,
  fallback: () => Rendered
): Promise<RenderedWithVersion> {
  return renderEmail(templateKey, tutoringStubContext(stub), 'parent', extra, fallback)
}
