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
