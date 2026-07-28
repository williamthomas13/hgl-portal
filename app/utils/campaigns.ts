import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin as supabase } from './supabase-admin'
import { signingSecret } from './signing'

// PL-201: Campaigns v1 — an offer send is a query plus a compose, not an
// afternoon of cross-referencing. The segment definition is a plain object
// (stored jsonb on the campaign — the v2 saved-segments seam); chips compose
// with AND; the resolver answers WHY each family matched, because nobody
// sends to a list they haven't seen. Recipients are parents (deduped on
// parent email); families with marketing_opt_out or a suppression row are
// excluded here AND re-checked inside sendOnce (the choke point).

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export type SegmentDef = {
  /** Took (paid) any class · optionally narrowed by type/school below. */
  tookClass?: boolean
  classType?: string
  schoolId?: string
  /** Currently active: a running engagement or a paid seat in an open class. */
  currentStudent?: boolean
  packageStatus?: 'active' | 'exhausted' | 'never'
  rateAtLeast?: number
  rateUnder?: number
  /** On a waitlist or interest list. */
  waitlisted?: boolean
  serviceKind?: 'tutoring' | 'class_only'
}

export type SegmentRecipient = {
  familyId: string
  email: string
  name: string
  students: string[]
  why: string[]
}

/** The plain-English chip line — "Took SAT Prep · No active package". */
export function segmentSummary(def: SegmentDef, schoolName?: string): string {
  const chips: string[] = []
  if (def.classType) chips.push(`Took ${def.classType}`)
  else if (def.tookClass) chips.push('Took a class')
  if (def.schoolId) chips.push(`at ${schoolName ?? 'the selected school'}`)
  if (def.currentStudent === true) chips.push('Current student')
  if (def.currentStudent === false) chips.push('Not currently enrolled')
  if (def.packageStatus === 'active') chips.push('Has active package hours')
  if (def.packageStatus === 'exhausted') chips.push('Package used up')
  if (def.packageStatus === 'never') chips.push('Never bought a package')
  if (def.rateAtLeast != null) chips.push(`Paying $${def.rateAtLeast}/hr or more`)
  if (def.rateUnder != null) chips.push(`Paying under $${def.rateUnder}/hr`)
  if (def.waitlisted) chips.push('On a waitlist or interest list')
  if (def.serviceKind === 'tutoring') chips.push('1-on-1 tutoring family')
  if (def.serviceKind === 'class_only') chips.push('Classes only, never 1-on-1')
  return chips.length > 0 ? chips.join(' · ') : 'Everyone we can email'
}

/**
 * Resolve a segment against the live data. Chips AND together; every
 * recipient carries the why-matched list. Suppressed/opted-out families are
 * excluded (and sendOnce re-checks at the choke point regardless).
 */
export async function resolveSegment(def: SegmentDef): Promise<SegmentRecipient[]> {
  const [famRes, enrRes, engRes, interestRes, suppRes] = await Promise.all([
    supabase
      .from('families')
      .select('id, parent_first_name, parent_last_name, parent_email, marketing_opt_out, students ( id, first_name )'),
    supabase
      .from('enrollments')
      .select(
        `id, payment_status, students!inner ( family_id, first_name ),
         classes ( id, class_type, status, school_id )`
      ),
    supabase
      .from('tutoring_engagements')
      .select('id, status, hourly_rate, funding, addon_id, students!inner ( family_id )'),
    supabase.from('class_interest').select('id, school_id, class_type, students!inner ( family_id )'),
    supabase.from('marketing_suppressions').select('email'),
  ])

  const suppressed = new Set(((suppRes.data as any[]) ?? []).map((s) => s.email.toLowerCase()))

  type FamilyFacts = {
    paidClasses: { classType: string; schoolId: string | null; status: string }[]
    waitlistedRows: number
    interestRows: number
    engagements: { status: string; rate: number; funding: string; addonId: string | null }[]
  }
  const facts = new Map<string, FamilyFacts>()
  const factFor = (famId: string) => {
    if (!facts.has(famId)) facts.set(famId, { paidClasses: [], waitlistedRows: 0, interestRows: 0, engagements: [] })
    return facts.get(famId)!
  }

  for (const e of ((enrRes.data as any[]) ?? [])) {
    const famId = one<any>(e.students)?.family_id
    const cls = one<any>(e.classes)
    if (!famId) continue
    if (e.payment_status === 'Paid' || e.payment_status === 'Completed') {
      if (cls) factFor(famId).paidClasses.push({ classType: cls.class_type, schoolId: cls.school_id, status: cls.status })
    }
    if (e.payment_status === 'Waitlisted') factFor(famId).waitlistedRows++
  }
  for (const i of ((interestRes.data as any[]) ?? [])) {
    const famId = one<any>(i.students)?.family_id
    if (famId) factFor(famId).interestRows++
  }
  for (const g of ((engRes.data as any[]) ?? [])) {
    const famId = one<any>(g.students)?.family_id
    if (famId)
      factFor(famId).engagements.push({
        status: g.status,
        rate: Number(g.hourly_rate),
        funding: g.funding,
        addonId: g.addon_id,
      })
  }

  // Package drawdown per family for active/exhausted (billing's consuming rule).
  const addonIds = [...facts.values()].flatMap((f) => f.engagements.map((e) => e.addonId)).filter(Boolean) as string[]
  const addonHours = new Map<string, number>()
  const addonUsed = new Map<string, number>()
  if (addonIds.length > 0) {
    const [{ data: addonRows }, { data: consuming }] = await Promise.all([
      supabase.from('enrollment_addons').select('id, hours').in('id', addonIds),
      supabase
        .from('tutoring_sessions')
        .select('duration_minutes, status, reschedule_notice, tutoring_engagements!inner ( addon_id )')
        .in('tutoring_engagements.addon_id', addonIds)
        .in('status', ['completed', 'no_show', 'forfeited', 'confirmed', 'proposed', 'rescheduled']),
    ])
    for (const a of (addonRows as any[]) ?? []) addonHours.set(a.id, Number(a.hours))
    for (const s of (consuming as any[]) ?? []) {
      if (s.status === 'rescheduled' && s.reschedule_notice !== 'late') continue
      const aid = one<any>(s.tutoring_engagements)?.addon_id
      if (aid) addonUsed.set(aid, (addonUsed.get(aid) ?? 0) + s.duration_minutes / 60)
    }
  }

  const out: SegmentRecipient[] = []
  for (const fam of ((famRes.data as any[]) ?? [])) {
    if (!fam.parent_email) continue
    if (fam.marketing_opt_out) continue
    if (suppressed.has(fam.parent_email.toLowerCase())) continue
    const f = facts.get(fam.id) ?? { paidClasses: [], waitlistedRows: 0, interestRows: 0, engagements: [] }
    const why: string[] = []

    const paidMatching = f.paidClasses.filter(
      (c) => (!def.classType || c.classType === def.classType) && (!def.schoolId || c.schoolId === def.schoolId)
    )
    if (def.tookClass || def.classType || def.schoolId) {
      if (paidMatching.length === 0) continue
      why.push(def.classType ? `took ${def.classType}` : 'took a class')
    }

    const activeEng = f.engagements.filter((e) => e.status === 'active')
    const isCurrent = activeEng.length > 0 || f.paidClasses.some((c) => c.status === 'open')
    if (def.currentStudent === true) {
      if (!isCurrent) continue
      why.push('current student')
    }
    if (def.currentStudent === false) {
      if (isCurrent) continue
      why.push('not currently enrolled')
    }

    if (def.packageStatus) {
      const famAddons = f.engagements.map((e) => e.addonId).filter(Boolean) as string[]
      const hasActiveHours = famAddons.some((id) => (addonHours.get(id) ?? 0) - (addonUsed.get(id) ?? 0) > 0)
      const hasExhausted = famAddons.some(
        (id) => addonHours.has(id) && (addonUsed.get(id) ?? 0) >= (addonHours.get(id) ?? 0)
      )
      if (def.packageStatus === 'active' && !hasActiveHours) continue
      if (def.packageStatus === 'exhausted' && !(hasExhausted && !hasActiveHours)) continue
      if (def.packageStatus === 'never' && famAddons.length > 0) continue
      why.push(
        def.packageStatus === 'active'
          ? 'has package hours'
          : def.packageStatus === 'exhausted'
            ? 'package used up'
            : 'never bought a package'
      )
    }

    if (def.rateAtLeast != null) {
      if (!f.engagements.some((e) => e.rate >= def.rateAtLeast!)) continue
      why.push(`pays $${def.rateAtLeast}+/hr`)
    }
    if (def.rateUnder != null) {
      if (!f.engagements.some((e) => e.rate < def.rateUnder!)) continue
      why.push(`pays under $${def.rateUnder}/hr`)
    }

    if (def.waitlisted) {
      if (f.waitlistedRows + f.interestRows === 0) continue
      why.push('on a waitlist/interest list')
    }

    if (def.serviceKind === 'tutoring') {
      if (f.engagements.length === 0) continue
      why.push('1-on-1 family')
    }
    if (def.serviceKind === 'class_only') {
      if (f.engagements.length > 0 || f.paidClasses.length === 0) continue
      why.push('classes only')
    }

    if (why.length === 0) why.push('reachable family')
    out.push({
      familyId: fam.id,
      email: fam.parent_email,
      name: `${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim() || fam.parent_email,
      students: ((fam.students as any[]) ?? []).map((s) => s.first_name),
      why,
    })
  }
  // One row per email (siblings' families are one record already; belt+braces).
  const seen = new Set<string>()
  return out.filter((r) => {
    const k = r.email.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens (house HMAC pattern; no login, GET-safe page + RFC 8058
// one-click POST endpoint).
// ---------------------------------------------------------------------------

function unsubSig(email: string): string {
  return createHmac('sha256', signingSecret()).update(`unsub:${email.toLowerCase()}`).digest('hex').slice(0, 32)
}

export function unsubscribeToken(email: string): string {
  return `${Buffer.from(email.toLowerCase()).toString('base64url')}.${unsubSig(email)}`
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [b64, given] = token.split('.')
  if (!b64 || !given) return null
  let email: string
  try {
    email = Buffer.from(b64, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const expected = Buffer.from(unsubSig(email))
  const got = Buffer.from(given)
  return expected.length === got.length && timingSafeEqual(expected, got) ? email : null
}

/** Record the opt-out: suppression row (gates marketing sends inside
 *  sendOnce) + the family flag when the email is a known parent. */
export async function suppressEmail(email: string, source?: string): Promise<void> {
  const lower = email.toLowerCase()
  await supabase
    .from('marketing_suppressions')
    .upsert({ email: lower, reason: 'unsubscribed', source: source ?? null }, { onConflict: 'email' })
  await supabase.from('families').update({ marketing_opt_out: true }).ilike('parent_email', lower)
}
