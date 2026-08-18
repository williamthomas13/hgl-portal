import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'

// PL-386: the family profile's contact facts, staff-editable in place.
// admin/ops only by construction (sessionRole admits admin|manager; tutors
// and instructors never reach /admin). Email edits are load-bearing —
// sign-in + every send — so they dedupe HONESTLY (editing to an email
// another family uses refuses with a link, never a silent merge) and record
// who/when. Emergency contact + arrival instruction + contact preference
// live on the freshest intake on file; with no intake there is nothing to
// edit and the panel says so.

/* eslint-disable @typescript-eslint/no-explicit-any */

const PARENT_FIELDS = ['parent_first_name', 'parent_last_name', 'parent_email', 'parent_phone'] as const
const STUDENT_FIELDS = ['student_email', 'student_phone', 'pronouns', 'grade_level', 'special_needs'] as const
const INTAKE_FIELDS = [
  'preferredContactMethod',
  'absentContactWho',
  'absentContactHow',
  'emergencyName',
  'emergencyPhone',
  'emergencyRelation',
] as const

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))

  if (body?.action === 'update_parent') {
    const familyId = typeof body.familyId === 'string' ? body.familyId : ''
    if (!familyId) return NextResponse.json({ error: 'Missing familyId.' }, { status: 400 })
    const patch: Record<string, unknown> = {}
    for (const k of PARENT_FIELDS) {
      if (body.fields?.[k] !== undefined) {
        const v = String(body.fields[k] ?? '').trim()
        patch[k] = k === 'parent_email' ? v.toLowerCase() : v || null
      }
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    if (patch.parent_email !== undefined) {
      const email = String(patch.parent_email ?? '')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return NextResponse.json(
          { error: 'That does not look like an email address — this is how the family signs in AND where everything sends.' },
          { status: 400 }
        )
      }
      // HONEST dedupe: never merge two families silently.
      const { data: other } = await supabase
        .from('families')
        .select('id, parent_first_name, parent_last_name')
        .eq('parent_email', email)
        .neq('id', familyId)
        .maybeSingle()
      if (other) {
        return NextResponse.json(
          {
            error: `${email} already belongs to ${other.parent_first_name ?? ''} ${other.parent_last_name ?? ''}'s family — two families can't share a sign-in email. Open that family to sort out which record is right.`,
            duplicateFamilyId: other.id,
          },
          { status: 409 }
        )
      }
      patch.contact_updated_by = caller.email
      patch.contact_updated_at = new Date().toISOString()
    }
    const { error } = await supabase.from('families').update(patch).eq('id', familyId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body?.action === 'update_student') {
    const studentId = typeof body.studentId === 'string' ? body.studentId : ''
    if (!studentId) return NextResponse.json({ error: 'Missing studentId.' }, { status: 400 })
    const patch: Record<string, unknown> = {}
    for (const k of STUDENT_FIELDS) {
      if (body.fields?.[k] !== undefined) patch[k] = String(body.fields[k] ?? '').trim() || null
    }
    if (patch.pronouns !== undefined && patch.pronouns != null && !['she_her', 'he_him', 'they_them', 'name_only'].includes(String(patch.pronouns))) {
      return NextResponse.json({ error: 'Pronouns must be one of the four options (or blank).' }, { status: 400 })
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    const { error } = await supabase.from('students').update(patch).eq('id', studentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body?.action === 'update_intake') {
    const leadId = typeof body.leadId === 'string' ? body.leadId : ''
    if (!leadId) return NextResponse.json({ error: 'Missing leadId.' }, { status: 400 })
    const { data: lead } = await supabase.from('leads').select('id, intake').eq('id', leadId).maybeSingle()
    if (!lead?.intake) {
      return NextResponse.json(
        { error: 'No intake on file to hold this — these answers get captured at intake.' },
        { status: 400 }
      )
    }
    const intake = { ...(lead.intake as Record<string, unknown>) }
    let touched = false
    for (const k of INTAKE_FIELDS) {
      if (body.fields?.[k] !== undefined) {
        intake[k] = String(body.fields[k] ?? '').trim() || null
        touched = true
      }
    }
    if (!touched) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    const { error } = await supabase.from('leads').update({ intake }).eq('id', leadId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
