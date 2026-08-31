import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import { sessionFamily } from '../../../utils/family-gate'

// PL-386: the family profile's contact facts, staff-editable in place.
// PL-422: parents edit their OWN facts through this SAME route (one write
// path — every surface updates identically). A parent caller is scoped hard:
// only their own family/student/lead rows, only the self-service field set,
// and NEVER the parent email (the sign-in identity — v1 says "contact us to
// change"; an unverified self-serve swap is off the table by design).
// Email edits are load-bearing — sign-in + every send — so they dedupe
// HONESTLY (editing to an email another family uses refuses with a link,
// never a silent merge) and record who/when. Emergency contact + arrival
// instruction + contact preference live on the freshest intake on file; with
// no intake there is nothing to edit and the panel says so.

/* eslint-disable @typescript-eslint/no-explicit-any */

// PL-419: `timezone` rides the parent action — the family's clock for every
// portal/email time render (derived at registration/intake, corrected here).
const PARENT_FIELDS = ['parent_first_name', 'parent_last_name', 'parent_email', 'parent_phone', 'timezone'] as const
const STUDENT_FIELDS = ['student_email', 'student_phone', 'pronouns', 'grade_level', 'special_needs'] as const
const INTAKE_FIELDS = [
  'preferredContactMethod',
  'absentContactWho',
  'absentContactHow',
  'emergencyName',
  'emergencyPhone',
  'emergencyRelation',
] as const

// PL-422: what a PARENT may touch — name + phone (email = sign-in identity,
// staff-mediated; timezone = derived/staff, PL-419); the student's phone,
// pronouns, grade, learning notes (never the student email); every intake
// answer (contact preference, emergency contact, arrival instruction).
const PARENT_SELF_FIELDS = new Set(['parent_first_name', 'parent_last_name', 'parent_phone'])
const STUDENT_SELF_FIELDS = new Set(['student_phone', 'pronouns', 'grade_level', 'special_needs'])

const FIELD_LABELS: Record<string, string> = {
  parent_first_name: 'the parent first name',
  parent_last_name: 'the parent last name',
  parent_phone: 'the parent phone number',
  student_phone: 'the student phone number',
  pronouns: 'the pronouns on file',
  grade_level: 'the grade level',
  special_needs: 'the learning notes',
  preferredContactMethod: 'the preferred contact method',
  absentContactWho: 'the arrival instruction',
  absentContactHow: 'the arrival instruction',
  emergencyName: 'the emergency contact',
  emergencyPhone: 'the emergency contact',
  emergencyRelation: 'the emergency contact',
}

/** PL-422C: the append-only trail every self-service edit leaves — the
 *  activity feeds derive from it. Failures never sink the edit itself. */
async function logParentEdit(opts: {
  familyId: string
  studentId?: string | null
  studentFirst?: string | null
  fields: string[]
}) {
  // "updated the parent phone number" / "updated Reggie's learning notes" —
  // the possessive absorbs the article.
  const labels = [
    ...new Set(
      opts.fields.map((f) => {
        const l = FIELD_LABELS[f] ?? f
        return opts.studentFirst ? l.replace(/^the (student )?/, '') : l
      })
    ),
  ]
  const summary = `updated ${opts.studentFirst ? `${opts.studentFirst}'s ` : ''}${labels.join(', ')}`
  const { error } = await supabase.from('family_fact_edits').insert({
    family_id: opts.familyId,
    student_id: opts.studentId ?? null,
    actor: 'parent',
    summary,
  })
  if (error) console.error('family_fact_edits log failed (edit stands):', error.message)
}

export async function POST(req: Request) {
  const staff = await sessionRole('staff')
  const family = staff ? null : await sessionFamily()
  if (!staff && !family) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))

  if (body?.action === 'update_parent') {
    const familyId = typeof body.familyId === 'string' ? body.familyId : ''
    if (!familyId) return NextResponse.json({ error: 'Missing familyId.' }, { status: 400 })
    if (family && !family.familyIds.includes(familyId)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    const patch: Record<string, unknown> = {}
    for (const k of PARENT_FIELDS) {
      if (body.fields?.[k] !== undefined) {
        if (family && !PARENT_SELF_FIELDS.has(k)) {
          return NextResponse.json(
            {
              error:
                k === 'parent_email'
                  ? 'Your email address is how you sign in and where everything sends — contact us and we will change it with you.'
                  : 'That field is updated by our staff — get in touch and we will sort it out.',
            },
            { status: 403 }
          )
        }
        const v = String(body.fields[k] ?? '').trim()
        patch[k] = k === 'parent_email' ? v.toLowerCase() : v || null
      }
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    if (patch.timezone !== undefined && patch.timezone != null) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: String(patch.timezone) })
      } catch {
        return NextResponse.json({ error: 'That is not a recognized timezone — pick one from the list.' }, { status: 400 })
      }
    }
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
      patch.contact_updated_by = staff!.email
      patch.contact_updated_at = new Date().toISOString()
    }
    if (family) {
      // PL-422: who/when — recorded as parent-edited.
      patch.contact_updated_by = `parent:${family.email}`
      patch.contact_updated_at = new Date().toISOString()
    }
    const { error } = await supabase.from('families').update(patch).eq('id', familyId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (family) {
      await logParentEdit({ familyId, fields: Object.keys(patch).filter((k) => !k.startsWith('contact_updated')) })
    }
    return NextResponse.json({ ok: true })
  }

  if (body?.action === 'update_student') {
    const studentId = typeof body.studentId === 'string' ? body.studentId : ''
    if (!studentId) return NextResponse.json({ error: 'Missing studentId.' }, { status: 400 })
    const { data: stu } = await supabase
      .from('students')
      .select('id, first_name, family_id')
      .eq('id', studentId)
      .maybeSingle()
    if (!stu) return NextResponse.json({ error: 'Unknown student.' }, { status: 404 })
    if (family && !family.familyIds.includes(stu.family_id)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    const patch: Record<string, unknown> = {}
    for (const k of STUDENT_FIELDS) {
      if (body.fields?.[k] !== undefined) {
        if (family && !STUDENT_SELF_FIELDS.has(k)) {
          return NextResponse.json(
            { error: 'That field is updated by our staff — get in touch and we will sort it out.' },
            { status: 403 }
          )
        }
        patch[k] = String(body.fields[k] ?? '').trim() || null
      }
    }
    if (patch.pronouns !== undefined && patch.pronouns != null && !['she_her', 'he_him', 'they_them', 'name_only'].includes(String(patch.pronouns))) {
      return NextResponse.json({ error: 'Pronouns must be one of the four options (or blank).' }, { status: 400 })
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    const { error } = await supabase.from('students').update(patch).eq('id', studentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (family) {
      await logParentEdit({
        familyId: stu.family_id,
        studentId,
        studentFirst: stu.first_name,
        fields: Object.keys(patch),
      })
      await supabase
        .from('families')
        .update({ contact_updated_by: `parent:${family.email}`, contact_updated_at: new Date().toISOString() })
        .eq('id', stu.family_id)
    }
    return NextResponse.json({ ok: true })
  }

  if (body?.action === 'update_intake') {
    const leadId = typeof body.leadId === 'string' ? body.leadId : ''
    if (!leadId) return NextResponse.json({ error: 'Missing leadId.' }, { status: 400 })
    const { data: lead } = await supabase
      .from('leads')
      .select('id, intake, family_id')
      .eq('id', leadId)
      .maybeSingle()
    if (!lead?.intake) {
      return NextResponse.json(
        { error: 'No intake on file to hold this — these answers get captured at intake.' },
        { status: 400 }
      )
    }
    if (family && (!lead.family_id || !family.familyIds.includes(lead.family_id))) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    const intake = { ...(lead.intake as Record<string, unknown>) }
    let touched = false
    const touchedFields: string[] = []
    for (const k of INTAKE_FIELDS) {
      if (body.fields?.[k] !== undefined) {
        intake[k] = String(body.fields[k] ?? '').trim() || null
        touched = true
        touchedFields.push(k)
      }
    }
    if (!touched) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    const { error } = await supabase.from('leads').update({ intake }).eq('id', leadId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (family && lead.family_id) {
      await logParentEdit({ familyId: lead.family_id, fields: touchedFields })
      await supabase
        .from('families')
        .update({ contact_updated_by: `parent:${family.email}`, contact_updated_at: new Date().toISOString() })
        .eq('id', lead.family_id)
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
