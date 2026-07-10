import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { renderSendRow } from '../../../../utils/comms-render'
import { sendOnce } from '../../../../utils/email'

// Feature A3 row actions (docs/COMMS_ATTENDANCE_PARENT_SPEC.md): cancel /
// hold / release / reschedule / send-now on email_sends rows, plus per-class
// bulk cancel/hold. Staff (admin + manager — spec §0 grants managers full
// comms access). Guard rails: only scheduled/held rows are actionable;
// cancelled rows are kept, never deleted; sent history is immutable.

type Body = {
  action: 'cancel' | 'hold' | 'release' | 'reschedule' | 'send_now' | 'bulk_cancel' | 'bulk_hold'
  ids?: string[]
  classId?: string
  reason?: string
  scheduledFor?: string
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const nowIso = new Date().toISOString()
  const ids = (body.ids ?? []).filter(Boolean)

  switch (body.action) {
    case 'cancel': {
      if (ids.length === 0) return NextResponse.json({ error: 'No rows.' }, { status: 400 })
      const { data, error } = await supabase
        .from('email_sends')
        .update({
          status: 'cancelled',
          cancel_reason: (body.reason ?? '').trim() || 'cancelled from comms dashboard',
          cancelled_by: caller.email,
          updated_at: nowIso,
        })
        .in('id', ids)
        .in('status', ['scheduled', 'held'])
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, affected: data?.length ?? 0 })
    }

    case 'hold': {
      if (ids.length === 0) return NextResponse.json({ error: 'No rows.' }, { status: 400 })
      const { data, error } = await supabase
        .from('email_sends')
        .update({ status: 'held', hold_reason: (body.reason ?? '').trim() || null, updated_at: nowIso })
        .in('id', ids)
        .eq('status', 'scheduled')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, affected: data?.length ?? 0 })
    }

    case 'release': {
      if (ids.length === 0) return NextResponse.json({ error: 'No rows.' }, { status: 400 })
      const { data, error } = await supabase
        .from('email_sends')
        .update({ status: 'scheduled', hold_reason: null, updated_at: nowIso })
        .in('id', ids)
        .eq('status', 'held')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, affected: data?.length ?? 0 })
    }

    case 'reschedule': {
      const when = Date.parse(body.scheduledFor ?? '')
      if (ids.length === 0 || !Number.isFinite(when)) {
        return NextResponse.json({ error: 'Need rows and a valid datetime.' }, { status: 400 })
      }
      // manually_rescheduled makes the projector keep its hands off this time.
      const { data, error } = await supabase
        .from('email_sends')
        .update({
          status: 'scheduled',
          scheduled_for: new Date(when).toISOString(),
          manually_rescheduled: true,
          hold_reason: null,
          updated_at: nowIso,
        })
        .in('id', ids)
        .in('status', ['scheduled', 'held'])
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, affected: data?.length ?? 0 })
    }

    case 'send_now': {
      if (ids.length === 0) return NextResponse.json({ error: 'No rows.' }, { status: 400 })
      let sent = 0
      const failures: string[] = []
      for (const id of ids) {
        const { data: row } = await supabase
          .from('email_sends')
          .select('id, dedupe_key, template_key, enrollment_id, class_id, recipient_email, status')
          .eq('id', id)
          .maybeSingle()
        if (!row || (row.status !== 'scheduled' && row.status !== 'held')) {
          failures.push(`${id}: not in a sendable state`)
          continue
        }
        const rendered = await renderSendRow(row)
        if (!rendered) {
          failures.push(`${row.template_key}: not renderable outside the pipeline`)
          continue
        }
        // Make the row due (and un-held) so sendOnce's claim goes through.
        await supabase
          .from('email_sends')
          .update({
            status: 'scheduled',
            scheduled_for: nowIso,
            manually_rescheduled: true,
            updated_at: nowIso,
          })
          .eq('id', row.id)
          .in('status', ['scheduled', 'held'])
        const status = await sendOnce({
          dedupeKey: row.dedupe_key,
          emailType: rendered.emailType,
          enrollmentId: row.enrollment_id ?? undefined,
          classId: row.class_id ?? undefined,
          to: [row.recipient_email],
          from: rendered.from,
          subject: rendered.subject,
          html: rendered.html,
        })
        if (status === 'sent') sent++
        else failures.push(`${row.template_key}: ${status}`)
      }
      return NextResponse.json({ ok: failures.length === 0, sent, failures })
    }

    case 'bulk_cancel':
    case 'bulk_hold': {
      if (!body.classId) return NextResponse.json({ error: 'Need classId.' }, { status: 400 })
      const patch =
        body.action === 'bulk_cancel'
          ? {
              status: 'cancelled',
              cancel_reason: (body.reason ?? '').trim() || 'bulk-cancelled for class',
              cancelled_by: caller.email,
              updated_at: nowIso,
            }
          : { status: 'held', hold_reason: (body.reason ?? '').trim() || 'bulk hold for class', updated_at: nowIso }
      const { data, error } = await supabase
        .from('email_sends')
        .update(patch)
        .eq('class_id', body.classId)
        .in('status', body.action === 'bulk_cancel' ? ['scheduled', 'held'] : ['scheduled'])
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, affected: data?.length ?? 0 })
    }

    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
}
