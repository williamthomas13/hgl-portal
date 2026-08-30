import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionTutor } from '../../../utils/tutor-gate'
import { enqueueGcalSync, processGcalQueue } from '../../../utils/gcal-sync'
import { recomputeTimecard } from '../../../utils/timecards'
import { workTypeOptions } from '../../../utils/work-types'
import {
  cancelCoverage,
  coverageCandidates,
  requestCoverage,
  respondCoverage,
} from '../../../utils/coverage'

// Tutor timecard actions (Phase 7b §7.2): the tutor's only required work is
// correcting exceptions — mark a no-show, adjust an actual duration within
// bounds — and confirming the card. Ownership is checked against the
// caller's instructors rows on every write; nothing on an approved/exported
// timecard can change (the reviewed number must not drift).

type Body =
  | { action: 'no_show'; session_id: string; note?: string }
  | { action: 'confirm_timecard'; timecard_id: string }
  | { action: 'set_work_type'; session_id: string; work_type: string }
  | { action: 'set_prep_minutes'; session_id: string; prep_minutes: number }
  | { action: 'add_note'; session_id: string; note: string; next_time?: string }
  | { action: 'coverage_candidates'; session_id: string }
  | { action: 'request_coverage'; session_id: string; candidate_id: string; note?: string }
  | { action: 'respond_coverage'; request_id: string; response: 'accept' | 'decline' }
  | { action: 'cancel_coverage'; request_id: string }
  | { action: 'student_notes'; student_id: string }
  | { action: 'get_email_prefs' }
  | {
      action: 'set_email_prefs'
      prefs: {
        pref_notes_reminders?: 'on' | 'weekly' | 'off'
        pref_class_digests?: 'on' | 'weekly' | 'off'
        pref_fyi_copies?: boolean
      }
    }

async function timecardLocked(timecardId: string | null): Promise<boolean> {
  if (!timecardId) return false
  const { data } = await supabase.from('timecards').select('status').eq('id', timecardId).maybeSingle()
  return data?.status === 'approved' || data?.status === 'exported'
}

export async function POST(req: Request) {
  const caller = await sessionTutor()
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  try {
    // PL-261: adjust_duration is GONE — a session bills and pays at its
    // scheduled length, so nothing may rewrite ends_at after the fact
    // (variable actuals made billing and payroll drift apart).
    // PL-327: tutors self-serve their informational-email preferences.
    // Operational emails (T5 timecards, T3-T schedule changes, SUB coverage)
    // are mandatory and have no switch.
    if (body.action === 'get_email_prefs') {
      const { data } = await supabase
        .from('instructors')
        .select('pref_notes_reminders, pref_class_digests, pref_fyi_copies')
        .in('id', caller.instructorIds)
        .limit(1)
        .maybeSingle()
      return NextResponse.json({
        prefs: {
          pref_notes_reminders: data?.pref_notes_reminders ?? 'on',
          pref_class_digests: data?.pref_class_digests ?? 'on',
          pref_fyi_copies: data?.pref_fyi_copies !== false,
        },
      })
    }
    if (body.action === 'set_email_prefs') {
      const p = body.prefs ?? {}
      const patch: Record<string, unknown> = {}
      if (p.pref_notes_reminders !== undefined) {
        if (!['on', 'weekly', 'off'].includes(p.pref_notes_reminders)) {
          return NextResponse.json({ error: 'Notes reminders: on, weekly, or off.' }, { status: 400 })
        }
        patch.pref_notes_reminders = p.pref_notes_reminders
      }
      if (p.pref_class_digests !== undefined) {
        if (!['on', 'weekly', 'off'].includes(p.pref_class_digests)) {
          return NextResponse.json({ error: 'Class digests: on, weekly, or off.' }, { status: 400 })
        }
        patch.pref_class_digests = p.pref_class_digests
      }
      if (p.pref_fyi_copies !== undefined) patch.pref_fyi_copies = p.pref_fyi_copies === true
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
      }
      const { error } = await supabase.from('instructors').update(patch).in('id', caller.instructorIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'no_show') {
      const { data: session } = await supabase
        .from('tutoring_sessions')
        .select('id, tutor_id, status, starts_at, ends_at, timecard_id')
        .eq('id', body.session_id)
        .maybeSingle()
      if (!session || !caller.instructorIds.includes(session.tutor_id)) {
        return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
      }
      if (await timecardLocked(session.timecard_id)) {
        return NextResponse.json(
          { error: 'This pay period has been approved — ask the Ops Director for a correction.' },
          { status: 400 }
        )
      }

      if (session.status !== 'completed' && session.status !== 'confirmed') {
        return NextResponse.json({ error: `A ${session.status} session cannot be marked no-show.` }, { status: 400 })
      }
      const { error } = await supabase
        .from('tutoring_sessions')
        .update({
          status: 'no_show',
          cancelled_at: new Date().toISOString(),
          cancelled_by: 'tutor',
          cancel_note: body.note ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await enqueueGcalSync(session.id, 'tutor marked no-show — XCL')
      after(() => processGcalQueue())

      if (session.timecard_id) await recomputeTimecard(session.timecard_id)
      return NextResponse.json({ ok: true })
    }

    // PL-112: substitute coverage — candidates are subject-qualified ONLY
    // (never the admin matching notes), one offer at a time, accept flips
    // the session onto the substitute's schedule.
    if (body.action === 'coverage_candidates') {
      const out = await coverageCandidates(body.session_id, caller.instructorIds)
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
      return NextResponse.json(out)
    }
    if (body.action === 'request_coverage') {
      const out = await requestCoverage({
        sessionId: body.session_id,
        candidateId: body.candidate_id,
        note: body.note,
        callerIds: caller.instructorIds,
      })
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
      return NextResponse.json(out)
    }
    if (body.action === 'respond_coverage') {
      if (body.response !== 'accept' && body.response !== 'decline') {
        return NextResponse.json({ error: 'Answer accept or decline.' }, { status: 400 })
      }
      const out = await respondCoverage({
        requestId: body.request_id,
        response: body.response,
        callerIds: caller.instructorIds,
      })
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
      after(() => processGcalQueue())
      return NextResponse.json(out)
    }
    if (body.action === 'cancel_coverage') {
      const out = await cancelCoverage({ requestId: body.request_id, callerIds: caller.instructorIds })
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
      return NextResponse.json(out)
    }

    // PL-132: a tutor's own memory of a student — the same note history a
    // substitute receives at handoff (PL-111/112). One tap from the schedule
    // list rather than a hunt. Scoped: only a tutor who actually teaches (or
    // is covering) this student can read it.
    if (body.action === 'student_notes') {
      const { data: mine } = await supabase
        .from('tutoring_sessions')
        .select('id')
        .eq('student_id', body.student_id)
        .in('tutor_id', caller.instructorIds)
        .limit(1)
      if (!mine?.length) {
        return NextResponse.json({ error: 'Not your student.' }, { status: 403 })
      }
      const { data: notes } = await supabase
        .from('session_notes')
        .select('note, next_time, created_at, tutoring_sessions!inner ( starts_at )')
        .eq('student_id', body.student_id)
        .order('created_at', { ascending: false })
        .limit(20)
      /* eslint-disable @typescript-eslint/no-explicit-any */
      return NextResponse.json({
        ok: true,
        notes: ((notes as any[]) ?? []).map((n) => ({
          startsAt: (Array.isArray(n.tutoring_sessions) ? n.tutoring_sessions[0] : n.tutoring_sessions)?.starts_at ?? null,
          note: n.note,
          nextTime: n.next_time,
        })),
      })
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }

    // PL-111: the short session note — what we worked on, parent-visible.
    // One per session, editable by its tutor any time (notes are living
    // handoff material, not frozen records).
    if (body.action === 'add_note') {
      const note = (body.note ?? '').trim()
      if (!note) return NextResponse.json({ error: 'The note cannot be empty.' }, { status: 400 })
      const { data: session } = await supabase
        .from('tutoring_sessions')
        .select('id, tutor_id, student_id, status')
        .eq('id', body.session_id)
        .maybeSingle()
      if (!session || !caller.instructorIds.includes(session.tutor_id)) {
        return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
      }
      if (session.status !== 'completed') {
        return NextResponse.json(
          { error: 'Notes go on completed sessions — this one is ' + session.status.replace('_', ' ') + '.' },
          { status: 400 }
        )
      }
      const { error } = await supabase.from('session_notes').upsert(
        {
          session_id: session.id,
          student_id: session.student_id,
          tutor_id: session.tutor_id,
          note,
          next_time: (body.next_time ?? '').trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      )
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    // PL-103: attribute a tutoring session's hours to a work type (the paper
    // timecard's columns). Options = the standard six + the tutor's own QBO
    // pay-type titles. Class-schedule sessions are always Class/Workshop and
    // have no per-session override here.
    if (body.action === 'set_work_type') {
      const { data: session } = await supabase
        .from('tutoring_sessions')
        .select('id, tutor_id, timecard_id')
        .eq('id', body.session_id)
        .maybeSingle()
      if (!session || !caller.instructorIds.includes(session.tutor_id)) {
        return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
      }
      if (await timecardLocked(session.timecard_id)) {
        return NextResponse.json(
          { error: 'This pay period has been approved — ask the Ops Director for a correction.' },
          { status: 400 }
        )
      }
      const { data: tutor } = await supabase
        .from('instructors')
        .select('pay_type_titles')
        .eq('id', session.tutor_id)
        .maybeSingle()
      const allowed = workTypeOptions(tutor?.pay_type_titles)
      if (!allowed.includes(body.work_type)) {
        return NextResponse.json(
          { error: `Unknown work type — pick one of: ${allowed.join(', ')}.` },
          { status: 400 }
        )
      }
      const { error } = await supabase
        .from('tutoring_sessions')
        .update({ work_type: body.work_type, updated_at: new Date().toISOString() })
        .eq('id', session.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    // PL-412B: per-session prep minutes — recorded with who/when, payable as
    // its own 'Prep Time' line. The >15-minute case is a soft UI note, never
    // a blocker; the 480 cap here is a sanity bound matching the DB check.
    if (body.action === 'set_prep_minutes') {
      const minutes = Number(body.prep_minutes)
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 480) {
        return NextResponse.json({ error: 'Prep time must be whole minutes (0–480).' }, { status: 400 })
      }
      const { data: session } = await supabase
        .from('tutoring_sessions')
        .select('id, tutor_id, timecard_id')
        .eq('id', body.session_id)
        .maybeSingle()
      if (!session || !caller.instructorIds.includes(session.tutor_id)) {
        return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
      }
      if (await timecardLocked(session.timecard_id)) {
        return NextResponse.json(
          { error: 'This pay period has been approved — ask the Ops Director for a correction.' },
          { status: 400 }
        )
      }
      const { error } = await supabase
        .from('tutoring_sessions')
        .update({
          prep_minutes: minutes === 0 ? null : minutes,
          prep_set_by: caller.email ?? null,
          prep_set_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      // The card total includes prep — keep it in step immediately.
      if (session.timecard_id) await recomputeTimecard(session.timecard_id)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'confirm_timecard') {
      const { data: tc } = await supabase
        .from('timecards')
        .select('id, tutor_id, status')
        .eq('id', body.timecard_id)
        .maybeSingle()
      if (!tc || !caller.instructorIds.includes(tc.tutor_id)) {
        return NextResponse.json({ error: 'Not your timecard.' }, { status: 403 })
      }
      if (tc.status !== 'open') {
        return NextResponse.json({ error: `Timecard is already ${tc.status.replace('_', ' ')}.` }, { status: 400 })
      }
      // PL-257b: fail closed on missing session notes — the SAME anti-join
      // the admin approval gate runs (admin/tutoring/timecard). Confirming
      // with notes missing just moved the block one desk over.
      const { data: cardSessions } = await supabase
        .from('tutoring_sessions')
        .select('id, starts_at, students ( first_name, last_name )')
        .eq('timecard_id', tc.id)
        .eq('status', 'completed')
      const sessionIds = (cardSessions ?? []).map((s: any) => s.id)
      const { data: notes } = sessionIds.length
        ? await supabase.from('session_notes').select('session_id').in('session_id', sessionIds)
        : { data: [] }
      const noted = new Set((notes ?? []).map((n: any) => n.session_id))
      const missing = (cardSessions ?? []).filter((s: any) => !noted.has(s.id))
      if (missing.length > 0) {
        const names = missing
          .slice(0, 5)
          .map((s: any) => {
            const st = Array.isArray(s.students) ? s.students[0] : s.students
            return `${st?.first_name ?? ''} ${st?.last_name ?? ''}`.trim() || 'a student'
          })
          .join(', ')
        return NextResponse.json(
          {
            error: `${missing.length} session${missing.length === 1 ? '' : 's'} on this timecard ${missing.length === 1 ? 'is' : 'are'} missing notes (${names}${missing.length > 5 ? ', …' : ''}). Add each note in the Session notes section, then confirm.`,
            missingNotes: missing.map((s: any) => s.id),
          },
          { status: 400 }
        )
      }
      const total = await recomputeTimecard(tc.id)
      const { error } = await supabase
        .from('timecards')
        .update({
          status: 'tutor_confirmed',
          tutor_confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', tc.id)
        .eq('status', 'open') // guard the race with an admin approving
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, total })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('portal tutoring route failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
