import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import {
  autopayToken,
  billingMonth,
  packageHoursUsedBefore,
  proposalToken,
  tutoringIcsToken,
} from '../utils/tutoring-billing'
import { loadContactInfo } from '../utils/tutoring-emails'
import RescheduleRequest from './reschedule-request'

// Parent tutoring surface (Phase 7d, spec §8) — un-stubs the comms spec's C3
// widget. Reads run as service role scoped to the signed-in parent's own
// family ids (derived from the session email — same linkage as RLS; the
// instructors join needs service role since parents hold no policy there).
// §8 design requirement: the portal is the convenient path, never the only
// path — every block offers the human alternative.

// PL-9: parent-facing weekly slots read "Mondays 4:00 PM", matching the
// 12-hour style everywhere else on this surface (times are the tutor's wall
// clock, per the "Times shown in …" note above the cards).
const WEEKDAY_PLURALS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

/** "2026-07" → the first instant of the NEXT month (UTC ISO). */
function nextMonthIso(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1)) // JS months are 0-based: m = next month
  return d.toISOString()
}

function fmtSlotTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const INVOICE_STATUS_COPY: Record<string, { label: string; cls: string }> = {
  draft: { label: 'In preparation', cls: 'bg-gray-100 text-gray-600' },
  proposed: { label: 'Awaiting your confirmation', cls: 'bg-blue-100 text-blue-700' },
  confirmed: { label: 'Confirmed', cls: 'bg-indigo-100 text-indigo-700' },
  invoicing: { label: 'Confirmed', cls: 'bg-indigo-100 text-indigo-700' }, // PL-114 transient claim state
  invoiced: { label: 'Invoice sent', cls: 'bg-amber-100 text-amber-800' },
  paid: { label: 'Paid', cls: 'bg-green-100 text-green-700' },
  past_due: { label: 'Payment outstanding', cls: 'bg-red-100 text-red-700' },
  void: { label: 'Cancelled', cls: 'bg-gray-200 text-gray-500' },
}

export default async function TutoringSection({ email }: { email: string }) {
  const { data: familyRows } = await supabase
    .from('families')
    .select('id, parent_email, timezone, autopay, stripe_payment_method_id')
    .ilike('parent_email', email)
  if (!familyRows || familyRows.length === 0) return null
  const familyIds = familyRows.map((f) => f.id)

  const [{ data: engagements }, { data: upcoming }, { data: invoices }] = await Promise.all([
    supabase
      .from('tutoring_engagements')
      .select(
        `id, status, funding, addon_id, hourly_rate, recurrence, location, student_id,
         students!inner ( first_name, last_name, family_id ),
         subjects ( name ),
         instructors ( name, timezone, default_location ),
         enrollment_addons:addon_id ( hours )`
      )
      .in('students.family_id', familyIds)
      .in('status', ['active', 'paused']),
    supabase
      .from('tutoring_sessions')
      .select(
        `id, engagement_id, starts_at, ends_at, status, reschedule_requested_at,
         students!inner ( first_name, family_id ),
         tutoring_engagements ( location, subjects ( name ) ),
         instructors ( name, timezone, default_location )`
      )
      .in('students.family_id', familyIds)
      .eq('status', 'confirmed')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(12),
    supabase
      .from('tutoring_invoices')
      .select('id, period, status, total, due_at, paid_at, stripe_hosted_invoice_url, change_requested_at')
      .in('family_id', familyIds)
      .order('period', { ascending: false })
      .limit(12),
  ])

  const hasTutoring = (engagements?.length ?? 0) > 0 || (invoices?.length ?? 0) > 0
  if (!hasTutoring) return null

  const family = familyRows[0]
  const tz =
    family.timezone ??
    one<any>((engagements as any[])?.[0]?.instructors)?.timezone ??
    'America/Denver'
  const contact = await loadContactInfo()
  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })

  // Package draw-down (C3 contract: purchased / remaining / next session).
  // PL-130: remaining comes from the SAME function the billing cycle uses
  // (packageHoursUsedBefore) — one source of truth, never a parallel count.
  const packageInfo = new Map<string, { purchased: number; remaining: number }>()
  for (const e of (engagements as any[]) ?? []) {
    if (e.funding !== 'package' || !e.addon_id) continue
    const purchased = Number(one<any>(e.enrollment_addons)?.hours ?? 0)
    const used = await packageHoursUsedBefore(e.id, '2999-01-01')
    packageInfo.set(e.id, { purchased, remaining: Math.max(0, Number((purchased - used).toFixed(1))) })
  }

  // PL-130 "Your month at a glance": this month's sessions, the invoice
  // total when one exists (the SAME number the family is billed), and a
  // labeled line for every non-session decrement — no silent hour loss.
  const monthStart = new Date().toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7)
  const { data: monthSessions } = await supabase
    .from('tutoring_sessions')
    .select('id, starts_at, status, reschedule_notice, duration_minutes, students!inner ( first_name, family_id )')
    .in('students.family_id', familyIds)
    .gte('starts_at', `${monthStart}-01T00:00:00Z`)
    .lt('starts_at', nextMonthIso(monthStart))
  const monthRows = ((monthSessions as any[]) ?? []).filter(
    (s) => !['cancelled'].includes(s.status) && (s.status !== 'rescheduled' || s.reschedule_notice === 'late')
  )
  const monthCount = monthRows.length
  const { data: monthInvoice } = await supabase
    .from('tutoring_invoices')
    .select('total, status')
    .in('family_id', familyIds)
    .eq('period', `${monthStart}-01`)
    .neq('status', 'void')
    .limit(1)
    .maybeSingle()
  const DECREMENT_LABELS: Record<string, string> = {
    forfeited: 'late cancellation',
    no_show: 'missed session',
    rescheduled: 'late reschedule (original time kept its cost)',
  }
  const decrements = monthRows
    .filter((s) => s.status in DECREMENT_LABELS)
    .map((s) => ({
      hours: Number((s.duration_minutes / 60).toFixed(1)),
      label: DECREMENT_LABELS[s.status],
      when: new Date(s.starts_at).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' }),
      student: one<any>(s.students)?.first_name ?? '',
    }))

  // PL-111: session notes — what the tutor and student worked on, straight
  // from the tutor after each session. Parent-visible by design.
  const { data: familyStudents } = await supabase
    .from('students')
    .select('id, first_name')
    .in('family_id', familyIds)
  const studentName = new Map(((familyStudents as any[]) ?? []).map((s) => [s.id, s.first_name]))
  const { data: recentNotes } = familyStudents?.length
    ? await supabase
        .from('session_notes')
        .select('id, student_id, note, next_time, tutoring_sessions!inner ( starts_at )')
        .in('student_id', (familyStudents as any[]).map((s) => s.id))
        .order('created_at', { ascending: false })
        .limit(12)
    : { data: [] }
  const noteRows = (((recentNotes as any[]) ?? [])
    .map((n) => ({
      id: n.id,
      studentFirst: studentName.get(n.student_id) ?? '',
      startsAt: one<any>(n.tutoring_sessions)?.starts_at as string | undefined,
      note: n.note as string,
      nextTime: n.next_time as string | null,
    }))
    .filter((n) => n.startsAt) as { id: string; studentFirst: string; startsAt: string; note: string; nextTime: string | null }[])
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))

  const proposedInvoice = (invoices ?? []).find((i) => i.status === 'proposed' || i.status === 'draft')
  const icsToken = tutoringIcsToken(family.id)
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-6 mt-8">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">1-on-1 tutoring</h2>
      <p className="text-xs text-gray-400 mb-4">
        Times shown in {tz.split('/').pop()?.replace('_', ' ')}.
      </p>

      {proposedInvoice && (
        <a
          href={`/tutoring/schedule/${proposalToken(proposedInvoice.id)}`}
          className="block mb-5 p-4 rounded-lg bg-blue-50 border border-blue-200 hover:bg-blue-100 transition"
        >
          <span className="font-bold text-hgl-slate">
            {billingMonth(String(proposedInvoice.period).slice(0, 7)).label} schedule is ready for your
            review →
          </span>
          <span className="block text-sm text-gray-600 mt-0.5">
            Confirm it or ask for changes — it locks in automatically after the review window.
          </span>
        </a>
      )}

      {/* Per-student engagement cards (spec §8: tutor first name, subject,
          weekly slots, next session, location) */}
      <div className="grid gap-3 sm:grid-cols-2 mb-6">
        {((engagements as any[]) ?? []).map((e) => {
          const student = one<any>(e.students)
          const tutor = one<any>(e.instructors)
          const next = ((upcoming as any[]) ?? []).find((s) => s.engagement_id === e.id)
          const pkg = packageInfo.get(e.id)
          return (
            <div key={e.id} className="border border-gray-200 rounded-lg p-4 text-sm">
              <div className="font-bold text-hgl-slate">
                {student?.first_name} — {one<any>(e.subjects)?.name}
              </div>
              <div className="text-gray-600">with {(tutor?.name ?? 'your tutor').split(' ')[0]}</div>
              {Array.isArray(e.recurrence) && e.recurrence.length > 0 && (
                <div className="text-xs text-gray-500 mt-1">
                  {e.recurrence
                    .map((r: any) => `${WEEKDAY_PLURALS[r.weekday - 1]} ${fmtSlotTime(String(r.start_time).slice(0, 5))}`)
                    .join(' · ')}
                </div>
              )}
              {next && (
                <div className="text-xs text-green-700 mt-1">
                  Next: {fmtDay(next.starts_at)} {fmtTime(next.starts_at)}
                </div>
              )}
              {(e.location ?? tutor?.default_location) && (
                <div className="text-xs text-gray-400 mt-1 truncate">
                  {e.location ?? tutor?.default_location}
                </div>
              )}
              {pkg && (
                <div className="text-xs mt-2 bg-purple-50 border border-purple-200 rounded p-2 text-purple-900">
                  Package hours: <strong>{pkg.remaining}</strong> of {pkg.purchased} remaining
                </div>
              )}
              {e.status === 'paused' && (
                <div className="text-xs mt-2 text-amber-700 font-semibold">Paused — get in touch to resume</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Upcoming sessions + reschedule requests */}
      {((upcoming as any[]) ?? []).length > 0 && (
        <div className="mb-6">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="font-semibold text-hgl-slate text-sm">Upcoming sessions</h3>
            <span className="text-xs">
              <a href={`${base}/api/tutoring/calendar/${icsToken}?download=1`} className="text-hgl-blue underline">
                add to calendar
              </a>{' '}
              ·{' '}
              <a
                href={`webcal://${base.replace(/^https?:\/\//, '')}/api/tutoring/calendar/${icsToken}`}
                className="text-hgl-blue underline"
              >
                subscribe
              </a>
            </span>
          </div>
          <ul className="divide-y divide-gray-100 text-sm">
            {((upcoming as any[]) ?? []).map((s) => (
              <li key={s.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold text-hgl-slate">{fmtDay(s.starts_at)}</span>
                <span>
                  {fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}
                </span>
                <span className="text-gray-600">
                  {one<any>(s.students)?.first_name} · {one<any>(one<any>(s.tutoring_engagements)?.subjects)?.name}
                  {one<any>(s.instructors)?.name
                    ? ` · with ${String(one<any>(s.instructors).name).split(' ')[0]}`
                    : ''}
                </span>
                {(one<any>(s.tutoring_engagements)?.location ?? one<any>(s.instructors)?.default_location) && (
                  <span className="text-gray-400 text-xs truncate max-w-56">
                    {one<any>(s.tutoring_engagements)?.location ?? one<any>(s.instructors)?.default_location}
                  </span>
                )}
                <span className="ml-auto">
                  <RescheduleRequest
                    sessionId={s.id}
                    startsAt={s.starts_at}
                    alreadyRequested={Boolean(s.reschedule_requested_at)}
                    timezone={tz}
                    contactEmail={contact.email}
                    contactPhone={contact.phone}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* PL-130: "Your month at a glance" — the same numbers billing uses. */}
      {(monthCount > 0 || monthInvoice) && (
        <div className="mb-6">
          <h3 className="font-semibold text-hgl-slate text-sm mb-1">Your month at a glance</h3>
          <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded p-3 space-y-1">
            <p>
              {billingMonth(monthStart).label}: <strong>{monthCount}</strong> session{monthCount === 1 ? '' : 's'}
              {monthInvoice ? (
                <>
                  {' '}· month total <strong>${Number(monthInvoice.total).toFixed(2)}</strong>{' '}
                  <span className="text-gray-400">
                    ({(INVOICE_STATUS_COPY[monthInvoice.status]?.label ?? monthInvoice.status).toLowerCase()})
                  </span>
                </>
              ) : (
                <span className="text-gray-400"> · invoice not prepared yet</span>
              )}
            </p>
            {[...packageInfo.entries()].map(([engId, pkg]) => {
              const eng = ((engagements as any[]) ?? []).find((e) => e.id === engId)
              const st = one<any>(eng?.students)
              return (
                <p key={engId}>
                  Package hours remaining{st ? ` (${st.first_name})` : ''}:{' '}
                  <strong>{pkg.remaining}</strong> of {pkg.purchased}
                </p>
              )
            })}
            {decrements.length > 0 && (
              <div className="text-xs text-gray-500 pt-1 border-t border-gray-200">
                {decrements.map((d, i) => (
                  <p key={i}>
                    {d.hours} hour{d.hours === 1 ? '' : 's'} — {d.label}, {d.when}
                    {d.student ? ` (${d.student})` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PL-111: session notes — what they worked on, from the tutor. */}
      {noteRows.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-hgl-slate text-sm mb-1">What they worked on</h3>
          <ul className="divide-y divide-gray-100 text-sm">
            {noteRows.map((n) => (
              <li key={n.id} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold text-hgl-slate">{fmtDay(n.startsAt)}</span>
                  <span className="text-gray-600">{n.studentFirst}</span>
                </div>
                <p className="text-gray-700 text-xs mt-0.5">
                  {n.note}
                  {n.nextTime && <span className="text-gray-400"> · Next time: {n.nextTime}</span>}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Billing (spec §8: invoice history + autopay management) */}
      {((invoices as any[]) ?? []).length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-hgl-slate text-sm mb-1">Billing</h3>
          <ul className="divide-y divide-gray-100 text-sm">
            {((invoices as any[]) ?? []).map((i) => {
              const st = INVOICE_STATUS_COPY[i.status] ?? { label: i.status, cls: 'bg-gray-100 text-gray-600' }
              return (
                <li key={i.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-hgl-slate">
                    {billingMonth(String(i.period).slice(0, 7)).label}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${st.cls}`}>
                    {st.label}
                  </span>
                  <span className="text-gray-600">${Number(i.total).toFixed(2)}</span>
                  <span className="ml-auto text-xs">
                    {(i.status === 'invoiced' || i.status === 'past_due') && i.stripe_hosted_invoice_url && (
                      <a href={i.stripe_hosted_invoice_url} className="text-hgl-blue underline font-semibold">
                        view &amp; pay →
                      </a>
                    )}
                    {i.status === 'paid' && i.stripe_hosted_invoice_url && (
                      <a href={i.stripe_hosted_invoice_url} className="text-gray-500 underline">
                        receipt
                      </a>
                    )}
                    {(i.status === 'proposed' || i.status === 'draft') && (
                      <a href={`/tutoring/schedule/${proposalToken(i.id)}`} className="text-hgl-blue underline">
                        review schedule
                      </a>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-gray-500 mt-2">
            {family.autopay && family.stripe_payment_method_id ? (
              <>
                Autopay is <strong className="text-green-700">on</strong> — confirmed months charge your
                saved payment method automatically.{' '}
                <a href={`/tutoring/autopay/${autopayToken(family.id)}`} className="text-hgl-blue underline">
                  Manage
                </a>
              </>
            ) : (
              <>
                Tired of paying each invoice by hand?{' '}
                <a href={`/tutoring/autopay/${autopayToken(family.id)}`} className="text-hgl-blue underline">
                  Set up autopay
                </a>{' '}
                — months you&apos;ve confirmed charge automatically, with a receipt every time.
              </>
            )}
          </p>
        </div>
      )}

      <p className="text-sm text-gray-600 bg-gray-50 rounded p-3">
        Questions, or want to change anything by hand? Email{' '}
        <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
          {contact.email}
        </a>{' '}
        or give us a call at <strong>{contact.phone}</strong>{' — '}we&apos;re happy to do any of this for
        you.
      </p>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
