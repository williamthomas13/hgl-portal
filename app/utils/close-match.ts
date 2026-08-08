import { supabaseAdmin as supabase } from './supabase-admin'
import { emailBaseUrl } from './base-url'
import { sendAdminAlert } from './email'

// PL-313: close-match detection on incoming records. The Bunji case:
// pipeline lead "Bunji" (parent "BunjiPapa Kokobunji") + a later class
// registration "Bunji Kokobunji" (same parent) = two unlinked records, and
// nobody learns the prospective student actually signed up. Every hook that
// receives new person info (class registration, intake completion, lead add)
// calls scanCloseMatches; a plausible (lead × student) pair becomes ONE
// record_matches row — the dashboard's to-do, the leads page's side-by-side
// prompt, and the AL_CLOSE_MATCH alert all hang off it. NEVER auto-merged:
// linking is always an explicit admin/manager click. "Not the same" is
// remembered on the same row, so a rejected pair never re-asks.

/* eslint-disable @typescript-eslint/no-explicit-any */

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Small edit-distance for typo tolerance (same rule as the PL-194 radar). */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
  return dp[a.length][b.length]
}

/** Substring both ways ("Bunji" ⊂ "Bunji Kokobunji"), or within 2 edits. */
export function namesLookAlike(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a)
  const y = norm(b)
  if (x.length < 3 || y.length < 3) return false
  if (x === y) return true
  if (x.includes(y) || y.includes(x)) return true
  return x.length >= 4 && y.length >= 4 && editDistance(x, y) <= 2
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

type LeadRow = {
  id: string
  student_name: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  status: string
  student_id: string | null
}

type StudentRow = {
  id: string
  first_name: string
  last_name: string
  families: {
    id: string
    parent_first_name: string
    parent_last_name: string | null
    parent_email: string
  } | null
}

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

function matchReasons(lead: LeadRow, student: StudentRow): string[] {
  const fam = student.families
  const studentFull = `${student.first_name} ${student.last_name}`.trim()
  const parentFull = fam ? `${fam.parent_first_name} ${fam.parent_last_name ?? ''}`.trim() : ''
  const reasons: string[] = []
  if (namesLookAlike(lead.student_name, studentFull))
    reasons.push(`student names look alike (“${lead.student_name}” ↔ “${studentFull}”)`)
  if (namesLookAlike(lead.contact_name, parentFull))
    reasons.push(`parent names look alike (“${lead.contact_name}” ↔ “${parentFull}”)`)
  if (fam && lead.contact_email && norm(lead.contact_email) === norm(fam.parent_email))
    reasons.push(`same email (${fam.parent_email})`)
  const lp = digits(lead.contact_phone)
  void lp // families carry no phone column today; phone matching joins when one exists
  // A lone weak-name match prompts too much — require either a strong signal
  // (email) or at least one name likeness. Both-name likeness is strongest.
  return reasons
}

// High precision on purpose: a shared email alone is enough, otherwise it
// takes BOTH the student names and the parent names looking alike (the
// Bunji case). One lone name likeness against the whole student table would
// prompt constantly — the PL-194 typing-time radar already covers those.
function plausible(reasons: string[]): boolean {
  if (reasons.some((r) => r.startsWith('same email'))) return true
  return reasons.filter((r) => r.includes('names look alike')).length >= 2
}

async function recordMatch(
  lead: LeadRow,
  student: StudentRow,
  reasons: string[],
  enrollmentId: string | null
) {
  const fam = student.families
  // The unique pair remembers every prior answer — insert-if-new only.
  const { data: inserted, error } = await supabase
    .from('record_matches')
    .insert([
      {
        lead_id: lead.id,
        student_id: student.id,
        family_id: fam?.id ?? null,
        enrollment_id: enrollmentId,
        reasons,
      },
    ])
    .select('id')
    .maybeSingle()
  if (error || !inserted) return // duplicate pair (already asked/answered) or race — never re-ask

  const studentFull = `${student.first_name} ${student.last_name}`.trim()
  const leadName = lead.student_name || lead.contact_name || 'a pipeline lead'
  await sendAdminAlert({
    dedupeKey: `close_match:${inserted.id}`,
    adminEmail: process.env.ADMIN_EMAIL ?? 'williamraymondthomas@gmail.com',
    templateKey: 'AL_CLOSE_MATCH',
    subject: `Possible duplicate person — “${leadName}” and ${studentFull}`,
    body: `
      <p>The pipeline lead <strong>${leadName}</strong> looks like the same person as the
      registered student <strong>${studentFull}</strong>:</p>
      <ul>${reasons.map((r) => `<li>${r}</li>`).join('')}</ul>
      <p>Nothing was merged — take a look side by side and either link them or mark them as
      different people (that answer is remembered).</p>
      <p><a href="${emailBaseUrl()}/admin/leads?lead=${lead.id}&match=${inserted.id}">Review the pair →</a></p>`,
    vars: { alertStudentName: studentFull },
  }).catch((e) => console.error('close-match alert failed (to-do still stands):', e))
}

/** Scan around ONE new/updated record. Pass whichever side just arrived:
 *  a studentId (registration path) or a leadId (lead add / intake). */
export async function scanCloseMatches(opts: {
  studentId?: string
  leadId?: string
  enrollmentId?: string | null
}): Promise<number> {
  const leadSel = 'id, student_name, contact_name, contact_email, contact_phone, status, student_id'
  const studentSel =
    'id, first_name, last_name, families ( id, parent_first_name, parent_last_name, parent_email )'
  let found = 0

  if (opts.studentId) {
    const { data: s } = await supabase.from('students').select(studentSel).eq('id', opts.studentId).maybeSingle()
    const student = s ? ({ ...s, families: one((s as any).families) } as StudentRow) : null
    if (!student) return 0
    // Open pipeline: not closed, not already connected to a student record.
    const { data: leads } = await supabase
      .from('leads')
      .select(leadSel)
      .neq('status', 'lost')
      .is('student_id', null)
    for (const lead of ((leads as LeadRow[]) ?? [])) {
      const reasons = matchReasons(lead, student)
      if (!plausible(reasons)) continue
      await recordMatch(lead, student, reasons, opts.enrollmentId ?? null)
      found++
    }
  }

  if (opts.leadId) {
    const { data: l } = await supabase.from('leads').select(leadSel).eq('id', opts.leadId).maybeSingle()
    const lead = l as LeadRow | null
    if (!lead || lead.student_id) return found
    const { data: students } = await supabase.from('students').select(studentSel)
    for (const raw of ((students as any[]) ?? [])) {
      const student = { ...raw, families: one(raw.families) } as StudentRow
      const reasons = matchReasons(lead, student)
      if (!plausible(reasons)) continue
      await recordMatch(lead, student, reasons, null)
      found++
    }
  }

  return found
}
/* eslint-enable @typescript-eslint/no-explicit-any */
