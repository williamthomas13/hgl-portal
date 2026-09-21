// PL-460: THE registry of where every "go do this" call-to-action lands, and
// the control it must find there. Standing rule (Scarlett, Sep 20): an
// alert, email, banner, card, or Needs-Attention row that tells ANYONE —
// staff, parent, student, instructor/tutor, school contact, billing contact,
// lead — to act must land on a surface where that exact action can be
// completed in place: one tap to the control, the subject pre-selected.
// "Mark handled / dismiss" is never the only control unless acknowledging IS
// the whole job.
//
// The gate (scripts/regress-cta-landings.mjs) reads this file and FAILS when:
//   * a Needs-Attention `kind` in the dashboard route has no entry here;
//   * an entry's landing file is missing, or does not contain its `control`
//     marker (a data-testid or the literal control text that must be on the
//     page), or does not read the deep-link param its href carries;
//   * an email link variable in the registry has no entry in LINK_LANDINGS,
//     or its landing file lacks an invalid/expired-link branch.
// Adding a new alert/row means adding its landing here — that is the point.

export type StaffLanding = {
  /** The href pattern the row/alert emits (substring match on the literal part). */
  href: string
  /** The page file that renders the landing. */
  file: string
  /** Query params the href carries that the landing must read (`q.get('x')`). */
  params: string[]
  /** A marker that must exist in the landing's file tree: a data-testid or
   *  the literal control text. Proves the control is THERE, not a detour. */
  control: string
  /** Where the control marker lives when it is not in `file` itself. */
  controlFile?: string
}

/** Needs-Attention rows (app/api/admin/dashboard/route.ts) → landing + control. */
export const NEEDS_ATTENTION_LANDINGS: Record<string, StaffLanding> = {
  'Class needs an instructor': { href: '/admin?class=', file: 'app/admin/page.tsx', params: ['class'], control: 'instructor_id', controlFile: 'app/admin/page.tsx' },
  'Notebook order not yet at Printful': { href: '/admin?class=', file: 'app/admin/page.tsx', params: ['class', 'enrollment'], control: 'enrollment-', controlFile: 'app/admin/page.tsx' },
  'Collateral not set up': { href: '/admin?collateral=', file: 'app/admin/page.tsx', params: ['collateral'], control: 'collateralClassId' },
  'Synap group not set': { href: '/admin?synap=', file: 'app/admin/page.tsx', params: ['synap'], control: 'synap-' },
  'Minimum-enrollment decision': { href: '/admin?class=', file: 'app/admin/page.tsx', params: ['class', 'decision'], control: 'min-decision-' },
  'Class details missing': { href: '/admin?class=', file: 'app/admin/page.tsx', params: ['class'], control: 'default_location', controlFile: 'app/admin/page.tsx' },
  'Billed without signed agreement': { href: '/admin/tutoring?family=', file: 'app/admin/tutoring/page.tsx', params: ['family'], control: 'family-' },
  'QuickBooks sync failed': { href: '/admin?qbo=', file: 'app/admin/page.tsx', params: ['qbo'], control: 'qbo-' },
  'Email sent with unfilled placeholders': { href: '/admin/communications/templates?template=', file: 'app/admin/communications/templates/page.tsx', params: ['template'], control: 'selectTemplate' },
  'Intake complete — ready to schedule': { href: '/admin/leads?lead=', file: 'app/admin/leads/page.tsx', params: ['lead'], control: 'lead-' },
  'Session still needs coverage': { href: '/admin/tutoring?session=', file: 'app/admin/tutoring/page.tsx', params: ['session'], control: 'SessionDialog', controlFile: 'app/admin/tutoring/schedule-view.tsx' },
  'Timecard awaiting approval': { href: '/admin/tutoring?section=timecards&timecard=', file: 'app/admin/tutoring/page.tsx', params: ['timecard'], control: 'timecard-', controlFile: 'app/admin/tutoring/timecards-panel.tsx' },
  'Change requested — needs our reply': { href: '/admin/tutoring?invoice=', file: 'app/admin/tutoring/page.tsx', params: ['invoice'], control: 'send-updated-proposal', controlFile: 'app/admin/tutoring/invoices-panel.tsx' },
  'Reschedule request pending': { href: '/admin/tutoring?session=', file: 'app/admin/tutoring/page.tsx', params: ['session', 'reschedule'], control: 'SessionDialog', controlFile: 'app/admin/tutoring/schedule-view.tsx' },
  'Possible duplicate person': { href: '/admin/leads?lead=', file: 'app/admin/leads/page.tsx', params: ['lead'], control: 'lead-' },
  'Proposed session never resolved': { href: '/admin/tutoring?session=', file: 'app/admin/tutoring/page.tsx', params: ['session'], control: 'SessionDialog', controlFile: 'app/admin/tutoring/schedule-view.tsx' },
  'Refund requested': { href: '/admin?class=', file: 'app/admin/page.tsx', params: ['class', 'enrollment'], control: 'enrollment-' },
  'Class assignment conflicts with tutoring': { href: '/admin/tutoring?assignment=', file: 'app/admin/tutoring/page.tsx', params: ['assignment'], control: 'AssignmentConflicts' },
  'Wants 1-on-1 after the class': { href: '/admin/tutoring?family=', file: 'app/admin/tutoring/page.tsx', params: ['family'], control: 'family-' },
  'Hours block ending — awaiting family confirmation': { href: '/admin/tutoring?family=', file: 'app/admin/tutoring/page.tsx', params: ['family'], control: 'family-' },
  'Family declined — sessions past the block': { href: '/admin/tutoring?family=', file: 'app/admin/tutoring/page.tsx', params: ['family'], control: 'family-' },
  'Continue-tutoring choice needs scheduling': { href: '/admin/tutoring?continue=', file: 'app/admin/tutoring/page.tsx', params: ['continue'], control: 'scheduleContinuationFor' },
  'Hours past the package': { href: '/admin/tutoring?family=', file: 'app/admin/tutoring/page.tsx', params: ['family'], control: 'family-' },
  'No session location set': { href: '/admin/tutoring?family=', file: 'app/admin/tutoring/page.tsx', params: ['family'], control: 'family-' },
  'Missed call': { href: '/admin/tutoring?family=', file: 'app/admin/tutoring/page.tsx', params: ['family'], control: 'family-' },
  'Cancelled on the calendar, not in the portal': { href: '/admin/tutoring?session=', file: 'app/admin/tutoring/page.tsx', params: ['session'], control: 'SessionDialog', controlFile: 'app/admin/tutoring/schedule-view.tsx' },
  'Calendar edited outside the portal': { href: '/admin/tutoring?session=', file: 'app/admin/tutoring/page.tsx', params: ['session'], control: 'SessionDialog', controlFile: 'app/admin/tutoring/schedule-view.tsx' },
  'Invoice generation FAILING': { href: '/admin/tutoring?family=', file: 'app/admin/tutoring/page.tsx', params: ['family'], control: 'family-' },
  // Acknowledging IS the whole job for a sticky note; the row's own control.
  Note: { href: '/admin', file: 'app/admin/dashboard-panel.tsx', params: [], control: '/api/admin/dashboard-notes' },
  'Tutoring schedules in progress': { href: '/admin/tutoring?schedule=', file: 'app/admin/tutoring/page.tsx', params: ['schedule'], control: 'setWizardPreload' },
  'Staff registration unpaid': { href: '/admin?class=', file: 'app/admin/page.tsx', params: ['class', 'enrollment'], control: 'enrollment-' },
}

export type LinkLanding = {
  /** The route (or external host) the variable resolves to. */
  route: string
  /** For portal/tokenized routes: the page file; null = external (Stripe, Google, main site). */
  file: string | null
  /** Marker proving the page handles a bad/expired link with a next step. */
  invalidBranch?: string
}

/** Every registry email link variable → where it lands. */
export const LINK_LANDINGS: Record<string, LinkLanding> = {
  portalLink: { route: '/portal?enrollment=…&pe=&pt=', file: 'app/portal/page.tsx', invalidBranch: "redirect('/login" },
  resumePaymentLink: { route: '/api/resume-payment?e=&t=', file: 'app/api/resume-payment/route.ts', invalidBranch: 'link-help' },
  claimLink: { route: '/api/waitlist/claim?e=&t=', file: 'app/api/waitlist/claim/route.ts', invalidBranch: 'link-help' },
  declineLink: { route: '/waitlist/decline', file: 'app/waitlist/decline/page.tsx' },
  calendarLink: { route: '/classes/{id}/calendar', file: 'app/classes/[id]/calendar/page.tsx' },
  synapGroupLink: { route: 'external (Synap)', file: null },
  compassLink: { route: 'external (hgl.co)', file: null },
  reviewLink: { route: 'external (Google review)', file: null },
  discountLink: { route: 'external (highergroundprep.com)', file: null },
  examRegistrationLink: { route: 'external (College Board / ACT)', file: null },
  followOnRegistrationLink: { route: '/register/{slug}?fo=&fe=', file: 'app/register/[id]/page.tsx' },
  registrationLink: { route: '/register/{slug}', file: 'app/register/[id]/page.tsx' },
  confirmLink: { route: '/tutoring/schedule/{token}', file: 'app/tutoring/schedule/[token]/page.tsx', invalidBranch: 'PublicNoticeCard' },
  confirmOneTapLink: { route: '/tutoring/schedule/{token}?confirm=1', file: 'app/tutoring/schedule/[token]/page.tsx', invalidBranch: 'PublicNoticeCard' },
  approveLink: { route: '/tutoring/confirm/{token}', file: 'app/tutoring/confirm/[token]/page.tsx', invalidBranch: 'PublicNoticeCard' },
  invoiceUrl: { route: 'external (Stripe hosted invoice)', file: null },
  intakeFormLink: { route: '/intake/{token}', file: 'app/intake/[token]/page.tsx', invalidBranch: 'PublicNoticeCard' },
  agreementsLink: { route: '/agreements/{token}', file: 'app/agreements/[token]/page.tsx', invalidBranch: 'PublicNoticeCard' },
  autopayLink: { route: '/tutoring/autopay/{token}', file: 'app/tutoring/autopay/[token]/page.tsx', invalidBranch: 'PublicNoticeCard' },
  schedulePdfLink: { route: '/api/tutoring/schedule-pdf (signed)', file: null },
  availabilityLink: { route: '/availability/{token}', file: 'app/availability/[token]/page.tsx', invalidBranch: 'PublicNoticeCard' },
  classroomFormLink: { route: '/classroom-request/{id}?t=&ce=', file: 'app/classroom-request/[id]/page.tsx', invalidBranch: 'reply to' },
  timecardLink: { route: '/portal?view=tutor#portal-timecards', file: 'app/portal/tutor-view.tsx', invalidBranch: 'portal-timecards' },
  notesLink: { route: '/portal?view=tutor#portal-notes', file: 'app/portal/tutor-view.tsx', invalidBranch: 'portal-notes' },
  counselorRosterLink: { route: '/class-roster/{id}?t=&ce=', file: 'app/class-roster/[id]/page.tsx', invalidBranch: 'reply to' },
  salesPageLink: { route: 'external (evergreen code → class page)', file: null },
  surveyLink: { route: '/survey/{token}', file: 'app/survey/[token]/page.tsx', invalidBranch: 'PublicNoticeCard' },
  coverageRespondLink: { route: '/portal?view=tutor#portal-coverage', file: 'app/portal/tutor-view.tsx', invalidBranch: 'portal-coverage' },
  instructorViewLink: { route: '/portal?view=instructor&class={id}', file: 'app/portal/instructor-view.tsx', invalidBranch: 'FocusParam' },
}

/** PL-470: the public class page's STATE call-to-actions (closed / in-progress /
 *  cancelled / no-class) — each lands where the action completes. Checked by
 *  the gate like the rest: file exists, control present. */
export const PUBLIC_STATE_LANDINGS: Record<string, StaffLanding> = {
  'Already enrolled? Sign in': { href: '/login', file: 'app/login/login-form.tsx', params: [], control: 'type="email"' },
  'Talk to us — free consultation': { href: '/inquire?source=', file: 'app/inquire/page.tsx', params: ['source', 'interest', 'school'], control: 'InquiryForm' },
  'Add the schedule to your calendar': { href: '/classes/{id}/calendar', file: 'app/classes/[id]/calendar/page.tsx', params: [], control: 'Add to Google Calendar' },
  'Email me when it opens (interest list)': { href: '/api/class-interest', file: 'app/api/class-interest/route.ts', params: [], control: "from('class_interest')" },
  'See the class page (closed /register)': { href: 'page_path', file: 'app/register/[id]/registration-form.tsx', params: [], control: 'back-to-class-page' },
}
