import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { billingMonth, verifyProposalToken } from '../../../utils/tutoring-billing'
import { loadContactInfo } from '../../../utils/tutoring-emails'
import { PublicNoticeCard } from '../../../components/PublicNotice'
import ProposalActions from './proposal-actions'

// Parent-facing monthly schedule page (Phase 7c §6.2) — the signed-link
// target of T1/T1b. Replaces the calendar-screenshot email: list of proposed
// sessions per student, the month total, Confirm / Request changes. §8: the
// human path is always visible; nothing here is mandatory — a reply or a
// phone call reaches the same outcome.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const STATUS_COPY: Record<string, string> = {
  draft: 'Awaiting your confirmation',
  proposed: 'Awaiting your confirmation',
  confirmed: 'Confirmed — invoice on its way',
  invoiced: 'Confirmed — invoice sent',
  paid: 'Confirmed and paid — see you in class!',
  past_due: 'Confirmed — payment outstanding',
  void: 'This month was cancelled',
}

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invoiceId = verifyProposalToken(token)
  const contact = await loadContactInfo()

  const notFound = (
    <PublicNoticeCard title="We couldn't find that schedule">
      The link may be out of date. Email {contact.email}{' or call '} {contact.phone}{' and '} we&apos;ll sort
      it out for you.
    </PublicNoticeCard>
  )
  if (!invoiceId) return notFound

  const { data: invoice } = await supabase
    .from('tutoring_invoices')
    .select(
      `id, period, status, total, change_requested_at, stripe_hosted_invoice_url,
       families ( id, parent_first_name, timezone )`
    )
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return notFound
  const family: any = one(invoice.families)
  const month = billingMonth(String(invoice.period).slice(0, 7))

  // Sessions shown = this family's proposed + confirmed sessions in the month
  // (post-confirmation the page keeps working as "your September schedule").
  const y = Number(month.period.slice(0, 4))
  const m = Number(month.period.slice(5, 7))
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  const { data: sessions } = await supabase
    .from('tutoring_sessions')
    .select(
      `id, starts_at, ends_at, status,
       students!inner ( first_name, family_id ),
       tutoring_engagements ( location, subjects ( name ), instructors ( name, timezone ) )`
    )
    .eq('students.family_id', family?.id ?? '')
    .in('status', ['proposed', 'confirmed'])
    .gte('starts_at', month.firstDay + 'T00:00:00Z')
    .lt('starts_at', nextFirst + 'T23:59:59Z')
    .order('starts_at')

  const rows = ((sessions as any[]) ?? []).map((s) => {
    const eng = one<any>(s.tutoring_engagements)
    const tz = family?.timezone ?? one<any>(eng?.instructors)?.timezone ?? 'America/Denver'
    const d = new Date(s.starts_at)
    const e = new Date(s.ends_at)
    return {
      id: s.id,
      student: one<any>(s.students)?.first_name ?? '',
      subject: one<any>(eng?.subjects)?.name ?? '',
      tutor: (one<any>(eng?.instructors)?.name ?? '').split(' ')[0],
      location: eng?.location ?? null,
      day: d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }),
      time: `${d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}–${e.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}`,
    }
  })

  const { data: lines } = await supabase
    .from('tutoring_invoice_lines')
    .select('description, amount, kind')
    .eq('invoice_id', invoice.id)
    .order('created_at')

  const pending = invoice.status === 'draft' || invoice.status === 'proposed'

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
          <h1 className="text-2xl font-bold text-hgl-slate mb-1">
            {month.label} tutoring{family?.parent_first_name ? ` — ${family.parent_first_name}'s family` : ''}
          </h1>
          <p className="text-sm text-gray-500 mb-6">{STATUS_COPY[invoice.status] ?? invoice.status}</p>

          {rows.length > 0 ? (
            <ul className="divide-y divide-gray-100 mb-6">
              {rows.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="font-semibold text-hgl-slate">{r.day}</div>
                  <div className="text-sm text-gray-600">
                    {r.time} · {r.student} — {r.subject} with {r.tutor}
                    {r.location && <span className="text-gray-400"> · {r.location}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 italic mb-6">No sessions scheduled this month.</p>
          )}

          {(lines ?? []).length > 0 && Number(invoice.total) > 0 && (
            <div className="border-t border-gray-100 pt-4 mb-6 text-sm">
              {(lines ?? []).map((l, i) => (
                <div key={i} className="flex justify-between py-0.5 text-gray-600">
                  <span>{l.description}</span>
                  <span>${Number(l.amount).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-2 font-bold text-hgl-slate">
                <span>Month total</span>
                <span>${Number(invoice.total).toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Billed once you confirm; due by the end of this month. Once the month is confirmed
                and paid, changes become reschedules (free with 24+ hours&apos; notice).
              </p>
            </div>
          )}
          {Number(invoice.total) === 0 && rows.length > 0 && (
            <p className="text-sm text-green-700 mb-6">
              This month is covered by your prepaid package hours — nothing to pay.
            </p>
          )}

          {pending ? (
            <ProposalActions token={token} changeRequested={Boolean(invoice.change_requested_at)} />
          ) : invoice.stripe_hosted_invoice_url && ['invoiced', 'past_due'].includes(invoice.status) ? (
            <a
              href={invoice.stripe_hosted_invoice_url}
              className="inline-block bg-hgl-slate text-white py-2.5 px-6 rounded font-bold hover:opacity-90"
            >
              View &amp; pay the invoice →
            </a>
          ) : null}
        </div>

        <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-gray-600">
          Questions, or want to handle this by hand? Email{' '}
          <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
            {contact.email}
          </a>{' '}
          or give us a call at <strong>{contact.phone}</strong>{' — '}we&apos;re happy to make any change
          for you.
        </div>
      </div>
    </div>
  )
}
