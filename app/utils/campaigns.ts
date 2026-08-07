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
  /** PL-280: narrow tookClass by outcome / date range (class start date). */
  classOutcome?: 'completed' | 'cancelled' | 'refunded' | 'waitlisted_only'
  tookSince?: string // YYYY-MM-DD
  tookBefore?: string
  /** Currently active: a running engagement or a paid seat in an open class. */
  currentStudent?: boolean
  packageStatus?: 'active' | 'exhausted' | 'never'
  rateAtLeast?: number
  rateUnder?: number
  /** On a waitlist or interest list. */
  waitlisted?: boolean
  serviceKind?: 'tutoring' | 'class_only'
  /** PL-280: tutoring history — never / active / lapsed (no session in N months). */
  tutoringStatus?: 'never' | 'active' | 'lapsed'
  lapsedMonths?: number // default 6, with tutoringStatus 'lapsed'
  hoursRemainingUnder?: number
  /** PL-280: financial history — SEGMENTATION ONLY. These facts never render
   *  into copy: no dollar-shaped variable exists in the composer vocabulary,
   *  so a template cannot leak them even by edit (gate-asserted). */
  spentAtLeast?: number
  purchasesAtLeast?: number
  balance?: 'none_outstanding' | 'past_due'
  usedPromoCode?: boolean
  refunded?: boolean
}

export type SegmentStudent = {
  id: string
  firstName: string
  /** null = no student email on record — no student leg possible. */
  email: string | null
}

export type SegmentRecipient = {
  familyId: string
  email: string
  name: string
  students: string[]
  /** PL-280: the students with ids/emails — paired sends pick legs from here. */
  studentRecords: SegmentStudent[]
  why: string[]
  /** PL-280 (per-person unsubscribe): the parent email has a suppression row
   *  — the family still lists (student legs may run); the parent leg is
   *  skipped and sendOnce enforces it regardless. */
  parentSuppressed: boolean
  /** Student emails with suppression rows (their legs skip). */
  suppressedStudentEmails: string[]
}

/** The plain-English chip line — "Took SAT Prep · No active package". */
export function segmentSummary(def: SegmentDef, schoolName?: string): string {
  const chips: string[] = []
  if (def.classType) chips.push(`Took ${def.classType}`)
  else if (def.tookClass) chips.push('Took a class')
  if (def.schoolId) chips.push(`at ${schoolName ?? 'the selected school'}`)
  if (def.classOutcome === 'completed') chips.push('finished it')
  if (def.classOutcome === 'cancelled') chips.push('their class was cancelled')
  if (def.classOutcome === 'refunded') chips.push('was refunded')
  if (def.classOutcome === 'waitlisted_only') chips.push('waitlisted, never enrolled')
  if (def.tookSince) chips.push(`starting ${def.tookSince} or later`)
  if (def.tookBefore) chips.push(`starting before ${def.tookBefore}`)
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
  if (def.tutoringStatus === 'never') chips.push('Never bought tutoring')
  if (def.tutoringStatus === 'active') chips.push('Active tutoring')
  if (def.tutoringStatus === 'lapsed') chips.push(`Tutoring lapsed ${def.lapsedMonths ?? 6}+ months`)
  if (def.hoursRemainingUnder != null) chips.push(`Under ${def.hoursRemainingUnder}h remaining`)
  if (def.spentAtLeast != null) chips.push(`Spent $${def.spentAtLeast}+ with us`)
  if (def.purchasesAtLeast != null) chips.push(`${def.purchasesAtLeast}+ purchases`)
  if (def.balance === 'none_outstanding') chips.push('No outstanding balance')
  if (def.balance === 'past_due') chips.push('Has a past-due invoice')
  if (def.usedPromoCode) chips.push('Used a promo code')
  if (def.refunded) chips.push('Was refunded before')
  return chips.length > 0 ? chips.join(' · ') : 'Everyone we can email'
}

/**
 * Resolve a segment against the live data. Chips AND together; every
 * recipient carries the why-matched list. Suppressed/opted-out families are
 * excluded (and sendOnce re-checks at the choke point regardless).
 */
export async function resolveSegment(def: SegmentDef): Promise<SegmentRecipient[]> {
  const [famRes, enrRes, engRes, interestRes, suppRes, invRes, sessRes] = await Promise.all([
    supabase
      .from('families')
      .select(
        'id, parent_first_name, parent_last_name, parent_email, marketing_opt_out, students ( id, first_name, student_email )'
      ),
    supabase
      .from('enrollments')
      .select(
        `id, payment_status, promo_code_used, class_price_paid, amount_paid,
         students!inner ( family_id, first_name ),
         classes ( id, class_type, status, school_id, price, start_date ),
         enrollment_addons ( price_paid )`
      ),
    supabase
      .from('tutoring_engagements')
      .select('id, status, hourly_rate, funding, addon_id, students!inner ( family_id )'),
    supabase.from('class_interest').select('id, school_id, class_type, students!inner ( family_id )'),
    supabase.from('marketing_suppressions').select('email'),
    // PL-280: financial history — the SAME columns the PL-204 term report
    // reads, so campaign money math can never disagree with the report.
    supabase.from('tutoring_invoices').select('family_id, status, total'),
    // PL-280: last tutoring session per family (the "lapsed" clock).
    supabase
      .from('tutoring_sessions')
      .select('starts_at, status, tutoring_engagements!inner ( students!inner ( family_id ) )')
      .in('status', ['completed', 'confirmed']),
  ])

  const suppressed = new Set(((suppRes.data as any[]) ?? []).map((s) => s.email.toLowerCase()))

  type ClassRow = {
    classType: string
    schoolId: string | null
    status: string
    startDate: string | null
    paymentStatus: string
  }
  type FamilyFacts = {
    classRows: ClassRow[]
    waitlistedRows: number
    interestRows: number
    engagements: { status: string; rate: number; funding: string; addonId: string | null }[]
    // Financial history (SEGMENTATION ONLY — never rendered into copy).
    lifetimeSpend: number
    purchases: number
    outstandingInvoices: number
    pastDueInvoices: number
    promoCodes: string[]
    refundedRows: number
    lastTutoringSession: string | null
  }
  const facts = new Map<string, FamilyFacts>()
  const factFor = (famId: string) => {
    if (!facts.has(famId))
      facts.set(famId, {
        classRows: [],
        waitlistedRows: 0,
        interestRows: 0,
        engagements: [],
        lifetimeSpend: 0,
        purchases: 0,
        outstandingInvoices: 0,
        pastDueInvoices: 0,
        promoCodes: [],
        refundedRows: 0,
        lastTutoringSession: null,
      })
    return facts.get(famId)!
  }

  for (const e of ((enrRes.data as any[]) ?? [])) {
    const famId = one<any>(e.students)?.family_id
    const cls = one<any>(e.classes)
    if (!famId) continue
    const f = factFor(famId)
    if (cls) {
      f.classRows.push({
        classType: cls.class_type,
        schoolId: cls.school_id,
        status: cls.status,
        startDate: cls.start_date ?? null,
        paymentStatus: e.payment_status,
      })
    }
    if (e.payment_status === 'Paid' || e.payment_status === 'Completed') {
      // Paid class money: the PL-142 snapshot, else the live price (the term
      // report's exact rule); add-ons at their frozen price_paid.
      f.lifetimeSpend += Number(e.class_price_paid ?? cls?.price ?? 0)
      f.purchases++
      for (const a of (e.enrollment_addons as any[]) ?? []) {
        f.lifetimeSpend += Number(a.price_paid ?? 0)
        f.purchases++
      }
    }
    if (e.payment_status === 'Waitlisted') f.waitlistedRows++
    if (e.payment_status === 'Refunded') f.refundedRows++
    if (e.promo_code_used) f.promoCodes.push(e.promo_code_used)
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
  for (const inv of ((invRes.data as any[]) ?? [])) {
    if (!inv.family_id) continue
    const f = factFor(inv.family_id)
    if (inv.status === 'paid') {
      f.lifetimeSpend += Number(inv.total ?? 0)
      f.purchases++
    }
    if (inv.status === 'invoiced' || inv.status === 'past_due') f.outstandingInvoices++
    if (inv.status === 'past_due') f.pastDueInvoices++
  }
  for (const s of ((sessRes.data as any[]) ?? [])) {
    const famId = one<any>(one<any>(s.tutoring_engagements)?.students)?.family_id
    if (!famId) continue
    const f = factFor(famId)
    const day = String(s.starts_at).slice(0, 10)
    if (!f.lastTutoringSession || day > f.lastTutoringSession) f.lastTutoringSession = day
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

  const nowIso = new Date().toISOString().slice(0, 10)
  const out: SegmentRecipient[] = []
  for (const fam of ((famRes.data as any[]) ?? [])) {
    if (!fam.parent_email) continue
    // The family-wide opt-out (the legacy family-token unsubscribe) still
    // excludes everyone — that's a deliberate whole-family decision. A
    // per-EMAIL suppression row does NOT drop the family anymore (PL-280:
    // parent and student decide separately) — it only skips that leg, and
    // sendOnce enforces it at the choke point regardless.
    if (fam.marketing_opt_out) continue
    const f = facts.get(fam.id) ?? factFor('__empty__')
    const why: string[] = []

    // Class-history chips: filter this family's class rows by type/school/
    // date, then test the asked-for outcome (default: paid or completed).
    const rowsMatching = f.classRows.filter(
      (c) =>
        (!def.classType || c.classType === def.classType) &&
        (!def.schoolId || c.schoolId === def.schoolId) &&
        (!def.tookSince || (c.startDate ?? '') >= def.tookSince) &&
        (!def.tookBefore || (c.startDate ?? '') < def.tookBefore)
    )
    const paidMatching = rowsMatching.filter(
      (c) => c.paymentStatus === 'Paid' || c.paymentStatus === 'Completed'
    )
    if (def.tookClass || def.classType || def.schoolId || def.tookSince || def.tookBefore || def.classOutcome) {
      const outcome = def.classOutcome
      let hit = false
      if (!outcome) hit = paidMatching.length > 0
      else if (outcome === 'completed') hit = rowsMatching.some((c) => c.paymentStatus === 'Completed')
      else if (outcome === 'refunded') hit = rowsMatching.some((c) => c.paymentStatus === 'Refunded')
      else if (outcome === 'cancelled')
        hit = rowsMatching.some(
          (c) => c.status === 'cancelled' && ['Paid', 'Completed', 'Refunded', 'Cancelled'].includes(c.paymentStatus)
        )
      else if (outcome === 'waitlisted_only')
        hit = rowsMatching.some((c) => c.paymentStatus === 'Waitlisted') && paidMatching.length === 0
      if (!hit) continue
      why.push(
        outcome === 'completed'
          ? `finished ${def.classType ?? 'a class'}`
          : outcome === 'refunded'
            ? 'was refunded on a class'
            : outcome === 'cancelled'
              ? 'their class was cancelled'
              : outcome === 'waitlisted_only'
                ? 'waitlisted, never enrolled'
                : def.classType
                  ? `took ${def.classType}`
                  : 'took a class'
      )
    }

    const activeEng = f.engagements.filter((e) => e.status === 'active')
    const paidOpenClasses = f.classRows.filter(
      (c) => (c.paymentStatus === 'Paid' || c.paymentStatus === 'Completed') && c.status === 'open'
    )
    const isCurrent = activeEng.length > 0 || paidOpenClasses.length > 0
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

    const anyPaidClass = f.classRows.some(
      (c) => c.paymentStatus === 'Paid' || c.paymentStatus === 'Completed'
    )
    if (def.serviceKind === 'tutoring') {
      if (f.engagements.length === 0) continue
      why.push('1-on-1 family')
    }
    if (def.serviceKind === 'class_only') {
      if (f.engagements.length > 0 || !anyPaidClass) continue
      why.push('classes only')
    }

    // PL-280: tutoring-history chips.
    if (def.tutoringStatus === 'never') {
      if (f.engagements.length > 0) continue
      why.push('never bought tutoring')
    }
    if (def.tutoringStatus === 'active') {
      if (activeEng.length === 0) continue
      why.push('active tutoring')
    }
    if (def.tutoringStatus === 'lapsed') {
      const months = def.lapsedMonths ?? 6
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - months)
      const cutoffIso = cutoff.toISOString().slice(0, 10)
      const lapsed =
        f.engagements.length > 0 &&
        activeEng.length === 0 &&
        (!f.lastTutoringSession || f.lastTutoringSession < cutoffIso)
      if (!lapsed) continue
      why.push(
        f.lastTutoringSession
          ? `tutoring lapsed (last session ${f.lastTutoringSession})`
          : 'tutoring lapsed (no sessions on record)'
      )
    }
    if (def.hoursRemainingUnder != null) {
      const famAddons = f.engagements.map((e) => e.addonId).filter(Boolean) as string[]
      const remaining = famAddons.reduce(
        (sum, id) => sum + Math.max(0, (addonHours.get(id) ?? 0) - (addonUsed.get(id) ?? 0)),
        0
      )
      if (!(famAddons.length > 0 && remaining < def.hoursRemainingUnder)) continue
      why.push(`${remaining.toFixed(1)}h remaining`)
    }

    // PL-280: financial-history chips — SEGMENTATION ONLY. These facts show
    // in the preview's WHY (Scarlett-facing) and never in family-facing copy
    // (no dollar-shaped composer variable exists — gate-asserted).
    if (def.spentAtLeast != null) {
      if (f.lifetimeSpend < def.spentAtLeast) continue
      why.push(`spent $${Math.round(f.lifetimeSpend).toLocaleString()} with us`)
    }
    if (def.purchasesAtLeast != null) {
      if (f.purchases < def.purchasesAtLeast) continue
      why.push(`${f.purchases} purchase${f.purchases === 1 ? '' : 's'}`)
    }
    if (def.balance === 'none_outstanding') {
      if (f.outstandingInvoices > 0) continue
      why.push('no outstanding balance')
    }
    if (def.balance === 'past_due') {
      if (f.pastDueInvoices === 0) continue
      why.push('has a past-due invoice')
    }
    if (def.usedPromoCode) {
      if (f.promoCodes.length === 0) continue
      why.push(`used code ${[...new Set(f.promoCodes)].join(', ')}`)
    }
    if (def.refunded) {
      if (f.refundedRows === 0) continue
      why.push('was refunded before')
    }

    if (why.length === 0) why.push('reachable family')
    const studentRecords: SegmentStudent[] = ((fam.students as any[]) ?? []).map((s) => ({
      id: s.id,
      firstName: s.first_name,
      email: (s.student_email as string | null)?.trim() || null,
    }))
    out.push({
      familyId: fam.id,
      email: fam.parent_email,
      name: `${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim() || fam.parent_email,
      students: studentRecords.map((s) => s.firstName),
      studentRecords,
      why,
      parentSuppressed: suppressed.has(fam.parent_email.toLowerCase()),
      suppressedStudentEmails: studentRecords
        .map((s) => s.email?.toLowerCase())
        .filter((e): e is string => Boolean(e && suppressed.has(e))),
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

/** Record the opt-out for THIS address only (gates marketing sends inside
 *  sendOnce). PL-280 (Scarlett's per-person rule): a parent unsubscribing
 *  no longer flips the family flag — parent and student decide separately,
 *  and one leg must never silence the other. The whole-family opt-out stays
 *  reachable via the legacy family-token unsubscribe path, which sets
 *  families.marketing_opt_out itself, deliberately. */
export async function suppressEmail(email: string, source?: string): Promise<void> {
  const lower = email.toLowerCase()
  await supabase
    .from('marketing_suppressions')
    .upsert({ email: lower, reason: 'unsubscribed', source: source ?? null }, { onConflict: 'email' })
}
