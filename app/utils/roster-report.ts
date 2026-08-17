import { supabaseAdmin as supabase } from './supabase-admin'
import { emailBaseUrl } from './base-url'
import { formatDateLong } from './dates'
import { sendAdminAlert } from './email'
import { auditXclDrift } from './gcal-sync'
import {
  DEFAULT_TIMEZONE,
  REGISTRATION_NOTIFY_EMAIL,
  localDate,
  localHour,
  type ClassBundle,
  type EnrollmentRow,
} from './lifecycle'

// Admin roster report (ADMIN email — upgraded Phase 2 weekly digest, July 8
// punch list). Lived inside the cron route until PL-380 moved it here so the
// real builder is verifiable outside a Monday-morning sweep, like every
// other sweep in utils. PL-380: dates render through the shared formatter
// ("October 13, 2026"), never raw ISO.

/** Build the report's sections from the live bundles — [] means "nothing to report". */
export async function buildRosterReportSections(bundles: ClassBundle[]): Promise<string[]> {
  const today = localDate(DEFAULT_TIMEZONE)
  const weekAgo = Date.now() - 7 * 24 * 3_600_000
  const sections: string[] = []

  const live = bundles.filter((b) => b.status !== 'cancelled' && b.lastSession >= today)
  const underMinInPerson: string[] = []
  const classBlocks: string[] = []
  // PL-274: school-less classes bucket under their own heading instead of
  // wearing a fabricated school label.
  const openClassBlocks: string[] = []
  for (const b of live) {
    const active = b.enrollments.filter((e: EnrollmentRow) =>
      ['Paid', 'Completed', 'Pending', 'Waitlisted'].includes(e.payment_status)
    )
    const paid = active.filter(
      (e) => e.payment_status === 'Paid' || e.payment_status === 'Completed'
    ).length
    const pending = active.filter((e) => e.payment_status === 'Pending').length
    const waitlisted = active.filter((e) => e.payment_status === 'Waitlisted').length
    const verdict =
      paid >= b.capacity
        ? `<span style="color:#15803d;font-weight:bold">FULL</span>`
        : paid >= b.minEnrollment
          ? `<span style="color:#15803d;font-weight:bold">runs (min ${b.minEnrollment} met)</span>`
          : `<span style="color:#b45309;font-weight:bold">below minimum — needs ${b.minEnrollment - paid} more paid</span>`
    if (paid < b.minEnrollment && b.deliveryMode !== 'online') {
      underMinInPerson.push(
        `<li><strong>${b.isOpenEnrollment ? b.classType : `${b.schoolLabel} ${b.classType}`}</strong> — ${paid} paid / ${b.minEnrollment} min, starts ${formatDateLong(b.firstSession)}</li>`
      )
    }
    const roster =
      active.length === 0
        ? '<li style="color:#64748b">no registrations yet</li>'
        : [...active]
            .sort((a, b2) => a.studentLastName.localeCompare(b2.studentLastName))
            .map((e) => {
              const isNew = new Date(e.enrolled_at).getTime() >= weekAgo
              return `<li>${e.studentFirstName} ${e.studentLastName} — ${e.payment_status}${
                isNew ? ' <span style="color:#0284c7;font-weight:bold">(new this week)</span>' : ''
              }</li>`
            })
            .join('')
    ;(b.isOpenEnrollment ? openClassBlocks : classBlocks).push(
      `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin:8px 0">
        <p style="margin:0"><strong>${b.isOpenEnrollment ? b.classType : `${b.schoolLabel} ${b.classType}`}</strong> — starts ${formatDateLong(b.firstSession)} ·
        ${paid} paid / ${pending} pending / ${waitlisted} waitlisted ·
        ${b.minEnrollment} min / ${b.capacity} cap · ${verdict}</p>
        <ul style="margin:6px 0 0">${roster}</ul>
      </div>`
    )
  }
  // Travel decisions first: in-person classes that don't run yet.
  // PL-267: no "(travel booking waits on these)" parenthetical.
  if (underMinInPerson.length > 0) {
    sections.push(
      `<p><strong style="color:#b45309">⚠ In-person classes under minimum</strong>:</p><ul>${underMinInPerson.join('')}</ul>`
    )
  }
  if (classBlocks.length > 0) {
    sections.push(`<p><strong>Enrollment for open classes:</strong></p>${classBlocks.join('')}`)
  }
  if (openClassBlocks.length > 0) {
    sections.push(
      `<p><strong>Higher Ground (open enrollment):</strong></p>${openClassBlocks.join('')}`
    )
  }

  // Feature B3 abuse guard: instructor class messages sent this week, so the
  // admin always knows what went out from the portal under the HGL identity.
  const { data: imSends } = await supabase
    .from('email_sends')
    .select('sender_email, subject_rendered, class_id, classes ( class_type, schools ( nickname ) )')
    .eq('template_key', 'IM_INSTRUCTOR_MESSAGE')
    .eq('is_test', false)
    .in('status', ['sent', 'delivered', 'bounced', 'complained'])
    .gte('sent_at', new Date(weekAgo).toISOString())
  if (imSends && imSends.length > 0) {
    const byMessage = new Map<string, { sender: string; subject: string; label: string; n: number }>()
    for (const row of imSends) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const cls = (Array.isArray(row.classes) ? row.classes[0] : row.classes) as any
      const school = cls ? (Array.isArray(cls.schools) ? cls.schools[0] : cls.schools) : null
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const key = `${row.sender_email}|${row.subject_rendered}`
      const entry = byMessage.get(key) ?? {
        sender: row.sender_email ?? '—',
        subject: row.subject_rendered ?? '—',
        label: cls ? `${school?.nickname ?? ''} ${cls.class_type}` : '—',
        n: 0,
      }
      entry.n++
      byMessage.set(key, entry)
    }
    const items = [...byMessage.values()]
      .map((m) => `<li><strong>${m.sender}</strong> → ${m.label} · "${m.subject}" (${m.n} recipients)</li>`)
      .join('')
    sections.push(
      `<p><strong>Instructor messages sent from the portal this week:</strong></p><ul>${items}</ul>`
    )
  }

  // Delivery problems from the Resend webhook: hard bounces on student
  // emails (bad addresses collected at registration) and spam complaints.
  const { data: events } = await supabase
    .from('email_events')
    .select('event_type, email_address, subject, bounce_type, created_at')
    .gte('created_at', new Date(weekAgo).toISOString())
  if (events && events.length > 0) {
    const studentEmails = new Set(
      bundles.flatMap((b) => b.enrollments.map((e) => e.studentEmail?.toLowerCase()).filter(Boolean))
    )
    const hardBounces = events.filter(
      (ev) =>
        ev.event_type === 'email.bounced' &&
        ev.bounce_type !== 'Transient' &&
        studentEmails.has(ev.email_address)
    )
    if (hardBounces.length > 0) {
      const items = hardBounces
        .map((ev) => `<li><strong>${ev.email_address}</strong>${ev.subject ? ` — "${ev.subject}"` : ''}</li>`)
        .join('')
      sections.push(
        `<p><strong>Student email hard bounces</strong> — these addresses are bad; fix them in the
         students table or the student misses every class email:</p><ul>${items}</ul>`
      )
    }
    const complaints = events.filter((ev) => ev.event_type === 'email.complained')
    if (complaints.length > 0) {
      const items = complaints
        .map((ev) => `<li><strong>${ev.email_address}</strong>${ev.subject ? ` — "${ev.subject}"` : ''}</li>`)
        .join('')
      sections.push(`<p><strong>Spam complaints</strong> — consider opting these families out:</p><ul>${items}</ul>`)
    }
  }

  // PL-154: the habit-lapse net, in the weekly report as well as on the
  // dashboard — a tutor who cancels in Google instead of the portal leaves a
  // session that still bills. Read-only: this reports, nobody's calendar is
  // touched.
  try {
    const drift = await auditXclDrift()
    if (drift.length > 0) {
      const items = drift
        .map(
          (d) =>
            `<li><a href="${emailBaseUrl()}/admin/tutoring?schedule=${d.sessionId}" style="color:#00AEEE">${d.studentName} with ${d.tutorName}</a>, ${new Date(d.startsAt).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' })} — calendar says "${d.eventTitle}"</li>`
        )
        .join('')
      sections.push(
        `<p><strong>Cancelled on the calendar, not in the portal</strong> — these sessions were
         marked XCL- (or deleted) in Google but are still scheduled here, so they will bill and
         count on the timecard as they stand. Cancel them in the portal to settle it:</p>
         <ul>${items}</ul>`
      )
    }
  } catch (e) {
    console.error('[PL-154] XCL audit failed (digest continues):', e)
  }

  return sections
}

/** Monday 8:00+ admin-local weekly send. Dedupe on the Monday date. */
export async function sweepAdminRosterReport(
  bundles: ClassBundle[],
  c: Record<string, number>
) {
  const today = localDate(DEFAULT_TIMEZONE)
  const isMonday = new Date(today + 'T12:00:00Z').getUTCDay() === 1
  if (!isMonday || localHour(DEFAULT_TIMEZONE) < 8) return

  const sections = await buildRosterReportSections(bundles)
  if (sections.length === 0) return

  const status = await sendAdminAlert({
    // Dedupe key kept from the Phase 2 weekly digest so a Monday deploy
    // can't send both the old and new report.
    dedupeKey: `weekly_digest:${today}`,
    adminEmail: REGISTRATION_NOTIFY_EMAIL,
    templateKey: 'AL_ROSTER_REPORT',
    subject: `Admin roster report — classes vs. minimums & email health`,
    body: sections.join(''),
  })
  if (status === 'sent') c.admin_roster_report = (c.admin_roster_report ?? 0) + 1
}
