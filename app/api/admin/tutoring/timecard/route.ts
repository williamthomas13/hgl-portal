import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { recomputeTimecard } from '../../../../utils/timecards'
import { processQboQueue } from '../../../../utils/qbo-sync'

// Staff timecard actions (Phase 7b §7.3): approve (freezes the number),
// mark exported after the CSV lands in QBO Payroll, reopen for corrections.
// Approval recomputes first so the frozen total reflects every correction.
// PL-281 adds push_qbo: approved hourly cards enqueue as TimeActivity rows
// on the existing sync rails (drained right behind the response + hourly).

type Body =
  | { action: 'approve'; ids: string[] }
  | { action: 'mark_exported'; ids: string[] }
  | { action: 'reopen'; ids: string[] }
  | { action: 'push_qbo'; ids: string[] }

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'Pass ids.' }, { status: 400 })
  }

  try {
    if (body.action === 'approve') {
      // PL-111 gate: a timecard cannot be approved while any of its period's
      // completed 1-on-1 sessions is missing a session note. The response
      // names each open session so the fix is a glance, not a hunt.
      const { data: cardSessions } = await supabase
        .from('tutoring_sessions')
        .select('id, starts_at, timecard_id, students ( first_name, last_name )')
        .in('timecard_id', body.ids)
        .eq('status', 'completed')
      const sessionIds = (cardSessions ?? []).map((s) => s.id)
      const { data: notes } = sessionIds.length
        ? await supabase.from('session_notes').select('session_id').in('session_id', sessionIds)
        : { data: [] }
      const noted = new Set((notes ?? []).map((n) => n.session_id))
      const missing = (cardSessions ?? [])
        .filter((s) => !noted.has(s.id))
        .map((s) => {
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          const st: any = Array.isArray(s.students) ? s.students[0] : s.students
          return {
            session_id: s.id,
            starts_at: s.starts_at,
            studentName: st ? `${st.first_name} ${st.last_name}` : '—',
          }
        })
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `Cannot approve yet — ${missing.length} session${missing.length === 1 ? ' is' : 's are'} missing a session note. The tutor adds notes from their portal; reopening is not needed.`,
            missingNotes: missing,
          },
          { status: 400 }
        )
      }

      let updated = 0
      for (const id of body.ids) {
        await recomputeTimecard(id) // no-ops if already approved/exported
        const { data } = await supabase
          .from('timecards')
          .update({
            status: 'approved',
            approved_by: caller.email,
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .in('status', ['open', 'tutor_confirmed'])
          .select('id')
        updated += data?.length ?? 0
      }
      return NextResponse.json({ ok: true, updated })
    }

    if (body.action === 'mark_exported') {
      const { data, error } = await supabase
        .from('timecards')
        .update({ status: 'exported', updated_at: new Date().toISOString() })
        .in('id', body.ids)
        .eq('status', 'approved')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, updated: data?.length ?? 0 })
    }

    if (body.action === 'reopen') {
      const { data, error } = await supabase
        .from('timecards')
        .update({
          status: 'open',
          approved_by: null,
          approved_at: null,
          tutor_confirmed_at: null,
          updated_at: new Date().toISOString(),
        })
        .in('id', body.ids)
        .neq('status', 'open')
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      for (const row of data ?? []) await recomputeTimecard(row.id)
      return NextResponse.json({ ok: true, updated: data?.length ?? 0 })
    }

    if (body.action === 'push_qbo') {
      // PL-281: matching failures fail LOUD at the button, before anything
      // enqueues — the response names each tutor who can't be pushed and
      // why; matched hourly cards enqueue and drain immediately.
      const { data: cards } = await supabase
        .from('timecards')
        .select(
          `id, status, total_hours, period_start, period_end,
           instructors ( name, email, pay_type, qbo_employee_id )`
        )
        .in('id', body.ids)
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const problems: string[] = []
      const pushable: string[] = []
      for (const c of (cards as any[]) ?? []) {
        const tutor = Array.isArray(c.instructors) ? c.instructors[0] : c.instructors
        const name = tutor?.name ?? tutor?.email ?? 'Unknown tutor'
        if (c.status !== 'approved') {
          problems.push(
            c.status === 'exported'
              ? `${name}: already exported (CSV or an earlier push) — pushing again would double their hours in QuickBooks, so it's skipped.`
              : `${name}: the card isn't approved yet (it reads "${c.status}").`
          )
        } else if (tutor?.pay_type === 'salaried') {
          problems.push(`${name}: salaried — hours are tracked for records and never pushed as hourly time.`)
        } else if (!tutor?.qbo_employee_id) {
          problems.push(
            `${name}: not matched to a QuickBooks employee yet — open Settings → QuickBooks → Employee matching, then push again.`
          )
        } else {
          pushable.push(c.id)
        }
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
      let queued = 0
      for (const id of pushable) {
        const { error } = await supabase
          .from('qbo_sync_log')
          .insert([{ timecard_id: id, kind: 'timecard_time' }])
        if (error) {
          if (error.code === '23505') {
            problems.push('One card was already queued or pushed — left alone.')
          } else {
            return NextResponse.json({ error: error.message }, { status: 500 })
          }
        } else {
          queued++
        }
      }
      if (queued > 0) after(() => processQboQueue())
      return NextResponse.json({ ok: true, queued, problems })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('timecard route failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
