import { supabaseAdmin } from '../../utils/supabase-admin'
import { sessionRole } from '../../utils/staff-gate'
import ParentView from '../../portal/parent-view'
import TutoringSection from '../../portal/tutoring-section'
import TutorView from '../../portal/tutor-view'
import CounselorView from '../../portal/counselor-view'
import {
  CLASS_WORK_TYPE,
  DEFAULT_TUTORING_WORK_TYPE,
  hoursByWorkType,
  sessionMinutes,
} from '../../utils/work-types'
import { renderVersion } from '../../utils/comms-db-render'
import { SAMPLE_CONTEXT, sampleExtraFor } from '../../utils/comms-variables'

// PL-102: "View as" — the admin sees exactly what each role's portal
// renders, clearly bannered, READ-ONLY (pointer events disabled on the
// preview). Admin-only: managers get a refusal, not a picker. The preview
// components are the REAL portal views (same code paths), scoped to the
// picked record's email — so what renders here is what that person sees,
// including everything they can't see (the PL-104 pay boundary).

/* eslint-disable @typescript-eslint/no-explicit-any */
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

const ROLES = [
  { id: 'parent', label: 'Parent' },
  { id: 'tutor', label: 'Tutor' },
  { id: 'school-contact', label: 'School contact' },
  { id: 'manager', label: 'Manager' },
] as const

export default async function ViewAsPage({ searchParams }: { searchParams: SearchParams }) {
  const caller = await sessionRole('admin')
  if (!caller) {
    return (
      <div className="min-h-screen bg-gray-50 p-10">
        <div className="max-w-2xl mx-auto bg-white rounded-lg border p-6 text-sm text-gray-600">
          &quot;View as&quot; is admin-only. If you need to check what someone sees, ask the Ops
          Director to look with you.
        </div>
      </div>
    )
  }
  const sp = await searchParams
  // PL-123: an unknown ?role= (typo'd link, stale bookmark) degrades to the
  // parent tab instead of a broken empty picker.
  const requestedRole = typeof sp.role === 'string' ? sp.role : 'parent'
  const role = ROLES.some((r) => r.id === requestedRole) ? requestedRole : 'parent'
  const pickedEmail = typeof sp.email === 'string' ? sp.email : ''

  // Picker options per role.
  const [
    { data: families, error: familiesErr },
    { data: tutors, error: tutorsErr },
    { data: contacts, error: contactsErr },
  ] = await Promise.all([
    supabaseAdmin
      .from('families')
      .select('parent_first_name, parent_last_name, parent_email')
      .order('parent_last_name')
      .limit(200),
    supabaseAdmin
      .from('instructors')
      .select('name, email')
      .eq('tutoring_active', true)
      .order('name'),
    // PL-123: an ACTIVE affiliation is one whose ended_at is null — the
    // table has no status column (the walkthrough's empty picker was this
    // query silently erroring).
    supabaseAdmin
      .from('school_affiliations')
      .select('contacts ( first_name, last_name, email ), schools ( nickname )')
      .is('ended_at', null)
      .limit(200),
  ])
  const options: { value: string; label: string }[] =
    role === 'parent'
      ? ((families as any[]) ?? []).map((f) => ({
          value: f.parent_email,
          label: `${f.parent_first_name} ${f.parent_last_name} (${f.parent_email})`,
        }))
      : role === 'tutor'
        ? ((tutors as any[]) ?? []).map((t) => ({ value: t.email, label: `${t.name ?? t.email}` }))
        : role === 'school-contact'
          ? ((contacts as any[]) ?? []).map((a) => {
              const c = Array.isArray(a.contacts) ? a.contacts[0] : a.contacts
              const s = Array.isArray(a.schools) ? a.schools[0] : a.schools
              return { value: c?.email ?? '', label: `${c?.first_name} ${c?.last_name} — ${s?.nickname}` }
            })
          : []
  const pickerError =
    role === 'parent' ? familiesErr : role === 'tutor' ? tutorsErr : role === 'school-contact' ? contactsErr : null
  const dedupedOptions = [...new Map(options.filter((o) => o.value).map((o) => [o.value, o])).values()]
  const pickedLabel = dedupedOptions.find((o) => o.value === pickedEmail)?.label ?? pickedEmail

  // PL-123 (Scarlett greenlit): the school-contact tab carries "what they
  // receive" — the rendered CD/CR/FP email set with sample data, through the
  // SAME sample-variable pipeline as the template editor (PL-96 rules:
  // composed blocks come from composers via sampleExtraFor). Drafts render
  // too (marked), since this doubles as a training aid for new staff.
  let counselorEmails: { key: string; label: string; subject: string; html: string; live: boolean }[] = []
  if (role === 'school-contact') {
    const { data: tpls } = await supabaseAdmin
      .from('email_templates')
      .select(
        `template_key, display_name, from_identity, category, live,
         version:email_template_versions!email_templates_active_version_fk
           ( subject, preheader, body_markdown, footer_note )`
      )
      .or('template_key.like.CD_%,template_key.like.CR_%,template_key.like.FP_%')
      .order('template_key')
    for (const t of (tpls as any[]) ?? []) {
      const v = Array.isArray(t.version) ? t.version[0] : t.version
      if (!v) continue
      try {
        const rendered = renderVersion(v, t, SAMPLE_CONTEXT, 'parent', sampleExtraFor(t.template_key))
        counselorEmails.push({
          key: t.template_key,
          label: t.display_name ?? t.template_key,
          subject: rendered.subject,
          html: rendered.html,
          live: Boolean(t.live),
        })
      } catch (e) {
        console.error(`view-as sample render failed for ${t.template_key}:`, e)
      }
    }
  }

  // Manager view: live pay-surface proof, computed from the same tables the
  // manager-facing panels read — hours and TITLES only, by construction.
  let managerPay: { tutor: string; period: string; lines: { workType: string; hours: number }[] }[] = []
  if (role === 'manager') {
    const { data: cards } = await supabaseAdmin
      .from('timecards')
      .select('id, period_start, period_end, instructors ( name, email )')
      .order('period_start', { ascending: false })
      .limit(3)
    for (const tc of (cards as any[]) ?? []) {
      const [{ data: tut }, { data: cls }] = await Promise.all([
        supabaseAdmin.from('tutoring_sessions').select('duration_minutes, work_type').eq('timecard_id', tc.id),
        supabaseAdmin.from('sessions').select('start_time, end_time').eq('timecard_id', tc.id),
      ])
      const ins = Array.isArray(tc.instructors) ? tc.instructors[0] : tc.instructors
      managerPay.push({
        tutor: ins?.name ?? ins?.email ?? '—',
        period: `${tc.period_start} → ${tc.period_end}`,
        lines: hoursByWorkType([
          ...((tut as any[]) ?? []).map((s) => ({
            workType: s.work_type ?? DEFAULT_TUTORING_WORK_TYPE,
            hours: s.duration_minutes / 60,
          })),
          ...((cls as any[]) ?? []).map((s) => ({
            workType: CLASS_WORK_TYPE,
            hours: sessionMinutes(s.start_time, s.end_time) / 60,
          })),
        ]),
      })
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* The banner — never mistakable for the real thing. */}
      <div className="bg-purple-700 text-white px-6 py-3 flex flex-wrap items-center gap-3 text-sm sticky top-0 z-40">
        <span className="font-bold">Viewing as {ROLES.find((r) => r.id === role)?.label ?? role}</span>
        {pickedLabel && role !== 'manager' && <span className="opacity-90">— {pickedLabel}</span>}
        <span className="opacity-75">· read-only preview</span>
        <a href="/admin" className="ml-auto underline font-semibold">
          Back to admin →
        </a>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {ROLES.map((r) => (
            <a
              key={r.id}
              href={`/admin/view-as?role=${r.id}`}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${
                role === r.id
                  ? 'bg-hgl-slate text-white border-hgl-slate'
                  : 'bg-white text-gray-600 border-gray-300'
              }`}
            >
              {r.label}
            </a>
          ))}
        </div>

        {role !== 'manager' && (
          <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="role" value={role} />
            <select name="email" defaultValue={pickedEmail} className="border border-gray-300 rounded p-2 bg-white max-w-md">
              <option value="">Pick a {ROLES.find((r) => r.id === role)?.label.toLowerCase()}…</option>
              {dedupedOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button type="submit" className="bg-hgl-slate text-white rounded px-4 py-2 font-semibold">
              View
            </button>
          </form>
        )}
        {/* PL-123: an erroring admin query must never look like "no data". */}
        {pickerError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            This picker hit a database error instead of returning records: {pickerError.message}
          </p>
        )}

        {/* The preview — the REAL portal components, pointer events off. */}
        {role === 'manager' ? (
          <div className="space-y-4">
            <div className="bg-white rounded-lg border p-5 text-sm text-gray-700 space-y-2">
              <h2 className="font-bold text-hgl-slate">What a manager sees</h2>
              <p>
                Managers use the same admin pages as you, minus the ownership-level pieces:
                QuickBooks connect/disconnect and item mapping, the contact settings panel, and
                editing a tutor&apos;s pay-type title list (read-only for managers; a database
                rule refuses the write regardless of the screen).
              </p>
              <p className="text-gray-500">
                On pay: the portal stores pay-type <strong>titles</strong> and <strong>hours</strong> only
                — no rates, no dollar amounts, for anyone. What a manager sees on a timecard is
                exactly what you see below. Family <em>billing</em>{' '}amounts stay visible to
                managers by design (that&apos;s invoicing, not payroll).
              </p>
            </div>
            <div className="bg-white rounded-lg border p-5 text-sm">
              <h3 className="font-bold text-hgl-slate mb-2">The pay surface, as a manager sees it</h3>
              {managerPay.length === 0 ? (
                <p className="text-gray-500 italic">No timecards yet.</p>
              ) : (
                <ul className="space-y-2">
                  {managerPay.map((c, i) => (
                    <li key={i}>
                      <span className="font-semibold text-hgl-slate">{c.tutor}</span>{' '}
                      <span className="text-gray-500">{c.period}</span>
                      <span className="block text-xs text-gray-600">
                        {c.lines.length === 0
                          ? 'no hours'
                          : c.lines.map((l) => `${l.workType}: ${l.hours} h`).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : !pickedEmail ? (
          <p className="text-sm text-gray-500 italic">Pick a record above to render their portal.</p>
        ) : (
          <div className="pointer-events-none select-text opacity-[0.99]" aria-label="Read-only preview">
            {role === 'parent' && (
              <>
                <ParentView supabase={supabaseAdmin} email={pickedEmail} />
                <TutoringSection email={pickedEmail} />
              </>
            )}
            {role === 'tutor' && <TutorView supabase={supabaseAdmin} email={pickedEmail} />}
            {role === 'school-contact' && <CounselorView supabase={supabaseAdmin} email={pickedEmail} />}
          </div>
        )}

        {/* PL-123: "what they receive" — the emails ARE most of the counselor
            relationship, and this doubles as a training aid for new staff.
            Rendered through the template editor's own sample pipeline. */}
        {role === 'school-contact' && (
          <div className="space-y-3">
            <div className="bg-white rounded-lg border p-5 text-sm text-gray-700 space-y-2">
              <h2 className="font-bold text-hgl-slate">What a school contact receives</h2>
              <p>
                Beyond their portal view above, most of the school relationship happens in email:
                the enrollment digest, the classroom-request loop, and the final-days pushes.
                Below is each one rendered with sample data — exactly the sample pipeline the
                template editor uses, so what you see here is what the copy ships as.
              </p>
            </div>
            {counselorEmails.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No school-contact templates found in the registry.</p>
            ) : (
              counselorEmails.map((e) => (
                <details key={e.key} className="bg-white rounded-lg border">
                  <summary className="cursor-pointer p-4 text-sm">
                    <span className="font-semibold text-hgl-slate">{e.label}</span>
                    {!e.live && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide font-bold bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                        draft — code copy sends until this goes live
                      </span>
                    )}
                    <span className="block text-gray-500 mt-0.5">Subject: {e.subject}</span>
                  </summary>
                  <div className="border-t border-gray-200 p-4 overflow-x-auto">
                    <div dangerouslySetInnerHTML={{ __html: e.html }} />
                  </div>
                </details>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
