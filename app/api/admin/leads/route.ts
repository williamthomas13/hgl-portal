import { emailBaseUrl } from '../../../utils/base-url'
import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { intakeToken } from '../../../utils/intake'
import { t7IntakeRequestEmail } from '../../../utils/intake-emails'
import { renderRegistered } from '../../../utils/comms-registered'
import { contactBlockHtml } from '../../../utils/tutoring-emails'
import { loadContactInfo } from '../../../utils/tutoring-emails'
import { sendOnce } from '../../../utils/email'
import {
  loadGcalConnection,
  createGcalEvent,
  patchGcalEvent,
  GcalApiError,
  type GcalEventInput,
} from '../../../utils/gcal'

// Lead pipeline actions (Phase 7e, spec §11): create/edit leads, send the
// tokenized intake form (T7, re-sendable), light consult scheduling with a
// best-effort Google Calendar push to the owner's calendar (direct call, not
// the session queue — a Google failure must never block the pipeline), and
// offer management. Reads happen in the browser under staff RLS; every
// mutation lands here.

const appUrl = () => emailBaseUrl()

const LEAD_FIELDS = [
  'source',
  'contact_name',
  'contact_email',
  'contact_phone',
  'student_name',
  'student_school',
  'student_grade',
  'interest',
  'subjects',
  'test_date',
  'prior_scores',
  'availability_text',
  'online_preference',
  'offer_id',
  'status',
  'assigned_to',
  'notes',
] as const

type Body =
  | ({ action: 'create' } & Record<string, unknown>)
  | ({ action: 'update'; id: string } & Record<string, unknown>)
  | { action: 'send_intake'; id: string }
  | { action: 'create_family'; id: string }
  | { action: 'schedule_consult'; id: string; consult_at: string; consult_owner_email: string }
  | { action: 'create_offer'; name: string; kind: string; value: number; notes?: string }
  | { action: 'update_offer'; id: string; active?: boolean; name?: string; value?: number; notes?: string }

function pickLeadFields(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const k of LEAD_FIELDS) {
    if (k in body) patch[k] = body[k] === '' ? null : body[k]
  }
  return patch
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

  try {
    if (body.action === 'create') {
      const patch = pickLeadFields(body as Record<string, unknown>)
      if (!patch.contact_name && !patch.contact_email && !patch.student_name) {
        return NextResponse.json({ error: 'Give the prospective student at least a name or an email.' }, { status: 400 })
      }
      const { data, error } = await supabase
        .from('leads')
        .insert({ ...patch, status: (patch.status as string) ?? 'new' })
        .select('id')
        .single()
      if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 })
      return NextResponse.json({ ok: true, id: data.id })
    }

    if (body.action === 'update') {
      if (!body.id) return NextResponse.json({ error: 'Missing lead id.' }, { status: 400 })
      const patch = pickLeadFields(body as Record<string, unknown>)
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
      }
      const { error } = await supabase
        .from('leads')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', body.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'send_intake') {
      if (!body.id) return NextResponse.json({ error: 'Missing lead id.' }, { status: 400 })
      const { data: lead } = await supabase
        .from('leads')
        .select('id, status, contact_name, contact_email, student_name')
        .eq('id', body.id)
        .maybeSingle()
      if (!lead) return NextResponse.json({ error: 'Unknown lead.' }, { status: 404 })
      if (!lead.contact_email) {
        return NextResponse.json({ error: 'They need a contact email first.' }, { status: 400 })
      }
      const contact = await loadContactInfo()
      const contactFirst = (lead.contact_name ?? '').trim().split(/\s+/)[0] || null
      const studentFirst = (lead.student_name ?? '').trim().split(/\s+/)[0] || null
      const intakeLink = `${appUrl()}/intake/${intakeToken(lead.id)}`
      // PL-13: registry template when live; code copy otherwise.
      const email = await renderRegistered(
        'T7_INTAKE_REQUEST',
        {
          parentFirstName: contactFirst ?? 'there',
          parentEmail: lead.contact_email,
          studentFirstName: studentFirst ?? 'your student',
        },
        { intakeFormLink: intakeLink, contactBlock: contactBlockHtml(contact) },
        () => t7IntakeRequestEmail({ contactFirst, studentFirst, link: intakeLink, contact })
      )
      // Timestamped dedupe key: re-sends are a feature ("chase the form"),
      // the email_sends log keeps the history.
      const sent = await sendOnce({
        dedupeKey: `t7_intake:${lead.id}:${Date.now()}`,
        emailType: 'T7_INTAKE_REQUEST',
        to: [lead.contact_email],
        subject: email.subject,
        html: email.html,
      })
      if (sent === 'failed') {
        return NextResponse.json({ error: 'Email send failed — check the comms dashboard.' }, { status: 500 })
      }
      await supabase
        .from('leads')
        .update({
          // Don't walk a further-along lead backwards on a re-send.
          ...(['new', 'contacted', 'intake_sent'].includes(lead.status) ? { status: 'intake_sent' } : {}),
          intake_token_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'create_family') {
      // PL-22: the one door for families that didn't come through a group
      // class — the New Student Schedule wizard only lists existing students.
      // Same dedupe rules as the intake submission: family matched by parent
      // email (never duplicated), student matched by name inside the family.
      if (!body.id) return NextResponse.json({ error: 'Missing lead id.' }, { status: 400 })
      const { data: lead } = await supabase
        .from('leads')
        .select('id, contact_name, contact_email, student_name, student_grade, family_id, student_id')
        .eq('id', body.id)
        .maybeSingle()
      if (!lead) return NextResponse.json({ error: 'Unknown lead.' }, { status: 404 })
      if (!lead.contact_email) {
        return NextResponse.json({ error: 'They need a contact email first.' }, { status: 400 })
      }
      if (!lead.student_name?.trim()) {
        return NextResponse.json({ error: 'They need a student name first.' }, { status: 400 })
      }

      const email = lead.contact_email.trim().toLowerCase()
      const [parentFirst, ...parentRest] = (lead.contact_name ?? '').trim().split(/\s+/)
      const { data: existingFamily } = await supabase
        .from('families')
        .select('id')
        .ilike('parent_email', email)
        .limit(1)
        .maybeSingle()
      let familyId = existingFamily?.id as string | undefined
      if (!familyId) {
        const { data: created, error } = await supabase
          .from('families')
          .insert([
            {
              parent_first_name: parentFirst || email,
              parent_last_name: parentRest.join(' ') || null,
              parent_email: email,
            },
          ])
          .select('id')
          .single()
        if (error || !created) {
          return NextResponse.json({ error: error?.message ?? 'Could not create the family.' }, { status: 500 })
        }
        familyId = created.id
      }

      const [studentFirst, ...studentRest] = lead.student_name.trim().split(/\s+/)
      const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
      const { data: familyStudents } = await supabase
        .from('students')
        .select('id, first_name, last_name')
        .eq('family_id', familyId)
      const match = (familyStudents ?? []).find(
        (s) => norm(s.first_name) === norm(studentFirst) && norm(s.last_name) === norm(studentRest.join(' '))
      )
      let studentId = match?.id as string | undefined
      if (!studentId) {
        const { data: student, error } = await supabase
          .from('students')
          .insert([
            {
              family_id: familyId,
              first_name: studentFirst,
              last_name: studentRest.join(' ') || '—',
              grade_level: lead.student_grade ?? null,
            },
          ])
          .select('id')
          .single()
        if (error || !student) {
          return NextResponse.json({ error: error?.message ?? 'Could not create the student.' }, { status: 500 })
        }
        studentId = student.id
      }

      await supabase
        .from('leads')
        .update({ family_id: familyId, student_id: studentId, updated_at: new Date().toISOString() })
        .eq('id', lead.id)
      return NextResponse.json({ ok: true, familyId, studentId })
    }

    if (body.action === 'schedule_consult') {
      if (!body.id || !body.consult_at || !body.consult_owner_email) {
        return NextResponse.json({ error: 'Need a date/time and an owner email.' }, { status: 400 })
      }
      const startMs = new Date(body.consult_at).getTime()
      if (!Number.isFinite(startMs)) {
        return NextResponse.json({ error: 'Invalid consult time.' }, { status: 400 })
      }
      const { data: lead } = await supabase
        .from('leads')
        .select('id, status, contact_name, contact_email, contact_phone, student_name, notes, consult_gcal_event_id')
        .eq('id', body.id)
        .maybeSingle()
      if (!lead) return NextResponse.json({ error: 'Unknown lead.' }, { status: 404 })

      const consultAtIso = new Date(startMs).toISOString()
      await supabase
        .from('leads')
        .update({
          consult_at: consultAtIso,
          consult_owner_email: body.consult_owner_email,
          ...(['new', 'contacted', 'intake_sent', 'intake_complete', 'consult_scheduled'].includes(lead.status)
            ? { status: 'consult_scheduled' }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id)

      // Best-effort Google push to the owner's calendar (spec §11: consult
      // synced via §4's push; failure must never block the pipeline).
      let gcal: 'synced' | 'skipped' | 'failed' = 'skipped'
      try {
        const conn = await loadGcalConnection()
        if (conn?.status === 'connected' && conn.key) {
          const who = lead.student_name || lead.contact_name || 'new family'
          const input: GcalEventInput = {
            tutorEmail: body.consult_owner_email,
            calendarId: null,
            summary: `Consult: ${who} — HGL tutoring`,
            description:
              `Tutoring consultation.\n` +
              `Contact: ${lead.contact_name ?? '—'} · ${lead.contact_email ?? '—'} · ${lead.contact_phone ?? '—'}\n` +
              (lead.notes ? `Notes: ${lead.notes}\n` : '') +
              `Lead record: ${appUrl()}/admin/leads`,
            location: null,
            startsAt: consultAtIso,
            endsAt: new Date(startMs + 60 * 60_000).toISOString(),
            timezone: 'America/Denver',
            attendees: [],
          }
          if (lead.consult_gcal_event_id) {
            try {
              await patchGcalEvent(conn.key, lead.consult_gcal_event_id, input)
              gcal = 'synced'
            } catch (e) {
              if (e instanceof GcalApiError && (e.status === 404 || e.status === 410)) {
                const id = await createGcalEvent(conn.key, input)
                await supabase.from('leads').update({ consult_gcal_event_id: id }).eq('id', lead.id)
                gcal = 'synced'
              } else {
                throw e
              }
            }
          } else {
            const id = await createGcalEvent(conn.key, input)
            await supabase.from('leads').update({ consult_gcal_event_id: id }).eq('id', lead.id)
            gcal = 'synced'
          }
        }
      } catch (e) {
        console.error('consult gcal push failed (consult stands):', e)
        gcal = 'failed'
      }
      return NextResponse.json({ ok: true, gcal })
    }

    if (body.action === 'create_offer') {
      if (!body.name || !body.kind || body.value == null) {
        return NextResponse.json({ error: 'Offers need a name, kind, and value.' }, { status: 400 })
      }
      const { error } = await supabase.from('tutoring_offers').insert({
        name: body.name,
        kind: body.kind,
        value: body.value,
        notes: body.notes ?? null,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'update_offer') {
      if (!body.id) return NextResponse.json({ error: 'Missing offer id.' }, { status: 400 })
      const patch: Record<string, unknown> = {}
      if ('active' in body) patch.active = body.active
      if (body.name != null) patch.name = body.name
      if (body.value != null) patch.value = body.value
      if ('notes' in body) patch.notes = body.notes
      const { error } = await supabase.from('tutoring_offers').update(patch).eq('id', body.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e) {
    console.error('leads route error:', e)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
