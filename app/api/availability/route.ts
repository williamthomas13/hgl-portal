import { emailBaseUrl } from '../../utils/base-url'
import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyAvailabilityToken } from '../../utils/intake'
import { validAvailabilityRanges } from '../../utils/availability'
import { sendAdminAlert } from '../../utils/email'
import { ADMIN_EMAIL } from '../../utils/lifecycle'
import { AVAILABILITY_PROPOSAL_BUSINESS_DAYS, addBusinessDays } from '../../utils/dates'
import { availabilityDiff, type AvailRange } from '../../utils/availability-diff'

// PL-53b: the add-on family's availability submission (from the tokenized
// /availability/{token} page, linked in #0 and the #8 scheduling fork).
// Same trust model as the intake link. Rows land in student_availability
// with source='parent'; re-submits replace the grid (latest family word
// wins, same as intake/staff saves); the Ops Director hears about it so
// scheduling can start.

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const familyId = typeof body.token === 'string' ? verifyAvailabilityToken(body.token) : null
  if (!familyId) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  }
  const studentId = typeof body.studentId === 'string' ? body.studentId : null
  if (!studentId) return NextResponse.json({ error: 'Missing student.' }, { status: 400 })
  if (!validAvailabilityRanges(body.availability)) {
    return NextResponse.json({ error: 'Please check the times — each range needs a start before its end.' }, { status: 400 })
  }
  let timezone = typeof body.timezone === 'string' ? body.timezone.slice(0, 60) : 'America/Denver'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    timezone = 'America/Denver'
  }

  // The token is family-scoped — the student must belong to that family.
  const { data: student } = await supabase
    .from('students')
    .select('id, first_name, last_name, family_id, families ( id, parent_first_name, parent_email )')
    .eq('id', studentId)
    .eq('family_id', familyId)
    .maybeSingle()
  if (!student) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })

  // PL-424: read what stood BEFORE the replacement — the update alert's
  // diff and the review surface both need the old grid (freebusy keeps no
  // history; the availability_changes row below does).
  const { data: priorRows } = await supabase
    .from('student_availability')
    .select('weekday, start_time, end_time, timezone, source')
    .eq('student_id', studentId)
  const before: AvailRange[] = ((priorRows ?? []) as AvailRange[]).map((r) => ({
    weekday: r.weekday,
    start_time: String(r.start_time).slice(0, 5),
    end_time: String(r.end_time).slice(0, 5),
    timezone: r.timezone ?? null,
  }))
  // An UPDATE means the family had already shared through this flow —
  // intake-only rows still count as a first share (that promise was never
  // made against them).
  const isUpdate = ((priorRows ?? []) as { source?: string }[]).some((r) => r.source === 'parent')

  // Whole-grid replacement — the family's newest word wins.
  const { error: clearError } = await supabase
    .from('student_availability')
    .delete()
    .eq('student_id', studentId)
  if (clearError) {
    console.error('availability clear failed:', clearError.message)
    return NextResponse.json({ error: 'Could not save — please try again.' }, { status: 500 })
  }
  if (body.availability.length > 0) {
    const { error: insertError } = await supabase.from('student_availability').insert(
      body.availability.map((r) => ({
        student_id: studentId,
        weekday: r.weekday,
        start_time: r.start_time,
        end_time: r.end_time,
        timezone,
        source: 'parent',
      }))
    )
    if (insertError) {
      console.error('availability insert failed:', insertError.message)
      return NextResponse.json({ error: 'Could not save — please try again.' }, { status: 500 })
    }
  }

  // PL-207: a submission that came from the portal tutoring card completes
  // the in-portal kickoff flow — stamp the student's add-ons so the
  // post-class scheduling emails (E8 + nudge) know they're redundant.
  if (body.src === 'card' && body.availability.length > 0) {
    const { data: enrs } = await supabase
      .from('enrollments')
      .select('id, enrollment_addons ( id )')
      .eq('student_id', studentId)
      .in('payment_status', ['Paid', 'Completed'])
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const addonIds = ((enrs as any[]) ?? []).flatMap((e) =>
      ((e.enrollment_addons ?? []) as { id: string }[]).map((a) => a.id)
    )
    if (addonIds.length > 0) {
      await supabase
        .from('enrollment_addons')
        .update({ portal_kickoff_done_at: new Date().toISOString() })
        .in('id', addonIds)
        .is('portal_kickoff_done_at', null)
    }
  }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const fam: any = Array.isArray(student.families) ? student.families[0] : student.families

  // PL-424: record the change — the review surface renders the SAME diff.
  const after: AvailRange[] = (body.availability as AvailRange[]).map((r) => ({
    weekday: r.weekday,
    start_time: String(r.start_time).slice(0, 5),
    end_time: String(r.end_time).slice(0, 5),
    timezone,
  }))
  const { data: changeRow } = await supabase
    .from('availability_changes')
    .insert({
      student_id: studentId,
      family_id: familyId,
      kind: isUpdate ? 'update' : 'first',
      before_ranges: before,
      after_ranges: after,
      timezone,
    })
    .select('id')
    .maybeSingle()

  if (isUpdate) {
    // PL-424C: an update SAYS it's an update — subject, composed old→new
    // diff, and what it may affect (the 3-business-day promise belongs to
    // first shares only). Once per distinct change.
    const diff = availabilityDiff(before, after)
    await sendAdminAlert({
      dedupeKey: `availability_updated:${studentId}:${changeRow?.id ?? new Date().toISOString()}`,
      adminEmail: ADMIN_EMAIL,
      templateKey: 'AL_AVAILABILITY_UPDATED',
      vars: {
        alertStudentName: `${student.first_name} ${student.last_name}`,
        alertParentName: fam?.parent_first_name ?? 'A parent',
      },
      subject: `${fam?.parent_first_name ?? 'A parent'} updated ${student.first_name} ${student.last_name}'s availability`,
      body: `<p><strong>${fam?.parent_first_name ?? 'A parent'}</strong> (${fam?.parent_email ?? '—'})
        updated ${student.first_name}'s shared availability${after.length === 0 ? ' (cleared it, actually)' : ''}. What changed:</p>
        <ul>${diff.lines.map((l) => `<li style="margin:2px 0">${l}</li>`).join('')}</ul>
        <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin/tutoring?availability=${studentId}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Review the change</a></p>
        <p>The review shows this diff against ${student.first_name}'s schedule and flags any
        scheduled sessions or proposals now OUTSIDE the new windows — nothing changes until you
        decide${fam?.id ? ` · <a href="${emailBaseUrl()}/admin/tutoring?family=${fam.id}" style="color:#00AEEE">the family record</a>` : ''}.</p>`,
    }).catch((e) => console.error('availability update alert failed (rows stand):', e))
    return NextResponse.json({ ok: true, updated: true })
  }

  await sendAdminAlert({
    // Dated key: a re-share after edits alerts again, same-day repeats don't.
    dedupeKey: `availability_shared:${studentId}:${new Date().toISOString().slice(0, 10)}`,
    adminEmail: ADMIN_EMAIL,
    templateKey: 'AL_AVAILABILITY_SHARED',
    vars: { alertStudentName: `${student.first_name} ${student.last_name}` },
    subject: `Add-on family shared availability — ${student.first_name} ${student.last_name} is ready to schedule`,
    // PL-92: the wizard opens with the student preselected and the freshly
    // shared windows loaded — suggestions compute on arrival.
    body: `<p><strong>${fam?.parent_first_name ?? 'A parent'}</strong> (${fam?.parent_email ?? '—'})
      shared ${student.first_name}'s availability${body.availability.length === 0 ? ' (cleared it, actually)' : ''}.</p>
      <p style="margin:20px 0"><a href="${emailBaseUrl()}/admin/tutoring?schedule=${studentId}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Schedule ${student.first_name} now</a></p>
      <p>The wizard opens with ${student.first_name} preselected and the just-shared windows
      loaded · <a href="${emailBaseUrl()}/admin/tutoring?availability=${studentId}" style="color:#00AEEE">the shared-windows view</a> shows
      them against the schedule${fam?.id ? ` · <a href="${emailBaseUrl()}/admin/tutoring?family=${fam.id}" style="color:#00AEEE">the family record</a>` : ''}.</p>
      <p><strong>The family has been told to expect proposed times by
      ${addBusinessDays(new Date().toISOString(), AVAILABILITY_PROPOSAL_BUSINESS_DAYS)}</strong>
      (${AVAILABILITY_PROPOSAL_BUSINESS_DAYS} business days — the same clock the dashboard counts down).</p>`,
  }).catch((e) => console.error('availability alert failed (rows stand):', e))

  return NextResponse.json({ ok: true, updated: false })
}
