import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import {
  confirmInvoice,
  rebuildProposalInvoice,
  requestChanges,
  verifyProposalToken,
  after7cConfirm,
} from '../../../utils/tutoring-billing'
import { computeRescheduleOffers } from '../../../utils/reschedule-offers'
import { issueOrCharge } from '../../../utils/tutoring-stripe'

// Public proposal actions (Phase 7c §6.2), authenticated by the signed link
// token — same trust model as waitlist-claim links. Confirm flips the
// month's sessions live (Google push) and hands the invoice to the payment
// leg; request-changes pauses the auto-confirm clock and pings the Ops
// Director.
//
// PL-62 quick-change layer: move_options / move / drop act on a single
// still-PROPOSED session of the family's own unconfirmed month. Moves offer
// only slots from the offered-slots machinery (§8 — client-supplied times
// are re-validated against the candidate set, never trusted), apply
// immediately (no fee — nothing is confirmed), and the invoice lines/total
// rebuild in place so the family confirms in the same sitting.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

/** The session must be a proposed one belonging to this invoice's family +
 *  billing month; the invoice must still be unconfirmed. */
async function loadFamilySession(invoiceId: string, sessionId: string) {
  const { data: invoice } = await supabase
    .from('tutoring_invoices')
    .select('id, family_id, period, status')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return { error: 'This link is no longer valid.' }
  if (!['draft', 'proposed'].includes(invoice.status)) {
    return { error: 'This month is already confirmed — reply to our email and we will adjust it for you.' }
  }
  const { data: session } = await supabase
    .from('tutoring_sessions')
    .select('id, status, starts_at, ends_at, engagement_id, student_id, tutor_id, students!inner ( family_id )')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session || one<any>(session.students)?.family_id !== invoice.family_id) {
    return { error: 'That session is not part of this schedule.' }
  }
  if (session.status !== 'proposed') {
    return { error: 'That session is already locked in — reply to our email and we will adjust it for you.' }
  }
  return { invoice, session }
}

async function familyTimezone(familyId: string): Promise<string> {
  const { data } = await supabase.from('families').select('timezone').eq('id', familyId).maybeSingle()
  return data?.timezone ?? 'America/Denver'
}

function slotLabel(startsAt: string, endsAt: string, tz: string) {
  const d = new Date(startsAt)
  const e = new Date(endsAt)
  const day = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' })
  const t1 = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  const t2 = e.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  return `${day}, ${t1}–${t2}`
}

export async function POST(req: Request) {
  let body: {
    token?: string
    action?: 'confirm' | 'request_changes' | 'move_options' | 'move' | 'drop'
    note?: string
    sessionId?: string
    startsAt?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const invoiceId = body.token ? verifyProposalToken(body.token) : null
  if (!invoiceId) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })

  if (body.action === 'confirm') {
    const res = await confirmInvoice(invoiceId, 'parent')
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    // Return the promise: after() only keeps the lambda alive for work it
    // can see. after7cConfirm covers the gcal drain AND issueOrCharge (the
    // registered follow-up) — importing tutoring-stripe here registers it.
    void issueOrCharge
    after(() => after7cConfirm(invoiceId))
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'request_changes') {
    if (!body.note?.trim()) return NextResponse.json({ error: 'Tell us what to change.' }, { status: 400 })
    const res = await requestChanges(invoiceId, body.note.slice(0, 2000))
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'move_options') {
    if (!body.sessionId) return NextResponse.json({ error: 'Missing session.' }, { status: 400 })
    const loaded = await loadFamilySession(invoiceId, body.sessionId)
    if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: 400 })
    const offers = await computeRescheduleOffers(body.sessionId, { allowProposed: true })
    const tz = await familyTimezone(loaded.invoice.family_id)
    if (offers.reason) console.log(`proposal move_options ${body.sessionId}: ${offers.reason}`)
    return NextResponse.json({
      ok: true,
      slots: offers.offered.map((s) => ({
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        label: slotLabel(s.starts_at, s.ends_at, tz),
      })),
    })
  }

  if (body.action === 'move') {
    if (!body.sessionId || !body.startsAt) {
      return NextResponse.json({ error: 'Missing session or time.' }, { status: 400 })
    }
    const loaded = await loadFamilySession(invoiceId, body.sessionId)
    if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: 400 })
    // §8 no-self-booking: recompute and accept only a candidate instant —
    // the client-supplied time is never trusted.
    const offers = await computeRescheduleOffers(body.sessionId, { allowProposed: true })
    const picked = offers.candidates.find((c) => c.starts_at === body.startsAt)
    if (!offers.session || !picked) {
      return NextResponse.json(
        { error: 'That time is no longer available — pick another, or tell us what works.' },
        { status: 409 }
      )
    }
    // Tombstone the original (a cycle re-run must not resurrect the slot),
    // create the replacement as a fresh proposed session.
    const nowIso = new Date().toISOString()
    const { data: cancelled } = await supabase
      .from('tutoring_sessions')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'parent',
        cancel_note: `moved on the proposal page to ${picked.starts_at}`,
        updated_at: nowIso,
      })
      .eq('id', body.sessionId)
      .eq('status', 'proposed')
      .select('id')
    if (!cancelled || cancelled.length === 0) {
      return NextResponse.json({ error: 'That session just changed — reload the page.' }, { status: 409 })
    }
    const { data: replacement, error: insErr } = await supabase
      .from('tutoring_sessions')
      .insert([
        {
          engagement_id: loaded.session.engagement_id,
          student_id: loaded.session.student_id,
          tutor_id: loaded.session.tutor_id,
          starts_at: picked.starts_at,
          ends_at: picked.ends_at,
          status: 'proposed',
          rate_snapshot: offers.session.rate_snapshot,
        },
      ])
      .select('id')
      .single()
    if (insErr || !replacement) {
      // Roll the tombstone back — the family's schedule must never lose a
      // session to a failed insert.
      await supabase
        .from('tutoring_sessions')
        .update({ status: 'proposed', cancelled_at: null, cancelled_by: null, cancel_note: null, updated_at: new Date().toISOString() })
        .eq('id', body.sessionId)
      return NextResponse.json({ error: 'Could not move the session — please try again.' }, { status: 500 })
    }
    await supabase
      .from('tutoring_sessions')
      .update({ rescheduled_to_id: replacement.id, updated_at: new Date().toISOString() })
      .eq('id', body.sessionId)
    const rebuilt = await rebuildProposalInvoice(invoiceId)
    if (!rebuilt.ok) console.error(`proposal move: line rebuild failed for ${invoiceId}: ${rebuilt.error}`)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'drop') {
    if (!body.sessionId) return NextResponse.json({ error: 'Missing session.' }, { status: 400 })
    const loaded = await loadFamilySession(invoiceId, body.sessionId)
    if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: 400 })
    const nowIso = new Date().toISOString()
    const { data: cancelled } = await supabase
      .from('tutoring_sessions')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'parent',
        cancel_note: 'dropped on the proposal page (pre-confirmation, no fee)',
        updated_at: nowIso,
      })
      .eq('id', body.sessionId)
      .eq('status', 'proposed')
      .select('id')
    if (!cancelled || cancelled.length === 0) {
      return NextResponse.json({ error: 'That session just changed — reload the page.' }, { status: 409 })
    }
    const rebuilt = await rebuildProposalInvoice(invoiceId)
    if (!rebuilt.ok) console.error(`proposal drop: line rebuild failed for ${invoiceId}: ${rebuilt.error}`)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
