// PL-307: which add-on tutoring price tier a class shows. ONE source for
// the flavor rule — the register page's package list (via class-info) and
// the checkout's server-side validation both call this, so they can never
// disagree. Leaf-safe on purpose (no imports).
//
// At-HGL = the open-enrollment in-person flavor (PL-274): no school, held
// in person at Higher Ground. Everything else — school cohorts, online
// open-enrollment — keeps the international tiers.

export type TutoringTier = 'domestic' | 'international'

export function classTutoringTier(cls: {
  school_id: string | null
  delivery_mode: string | null
}): TutoringTier {
  return cls.school_id === null && cls.delivery_mode === 'in_person'
    ? 'domestic'
    : 'international'
}

/** The same rule expressed on bundle/email-context shapes (isOpenEnrollment
 *  ⇔ school_id IS NULL) — one rule, two record shapes. */
export function enrollmentTutoringTier(ctx: {
  isOpenEnrollment: boolean
  deliveryMode: string | null
}): TutoringTier {
  return ctx.isOpenEnrollment && ctx.deliveryMode === 'in_person' ? 'domestic' : 'international'
}

// PL-322 provenance rule (recommended + implemented): when pricing tutoring
// with NO class in play, the student's tier comes from their MOST RECENT
// group-class enrollment's flavor; a student with no class history prices
// international (the pre-PL-322 sheet — nobody gets an unearned domestic
// discount, and staff can always override the rate on the engagement).
// The DB-driven half lives in lifecycle.ts (studentTutoringTier) — this
// module stays a pure leaf.
