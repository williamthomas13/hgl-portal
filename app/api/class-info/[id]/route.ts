import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { validateFollowOnDiscount } from '../../../utils/follow-on'
import { classTutoringTier } from '../../../utils/tutoring-tier'

// Public class details for the registration and calendar pages. Phase 3
// removed the browser's direct DB access (anon has no RLS policies), so the
// public pages fetch this sanitized payload instead: class + sessions +
// active pre-class packages + a computed isFull — never enrollment rows.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Slot = { payment_status: string; waitlist_offer_expires_at: string | null }

/** Spots taken = Pending + Paid + waitlisted holders of an unexpired offer. */
function spotsTakenRaw(slots: Slot[]): number {
  const now = Date.now()
  return slots.filter(
    (e) =>
      e.payment_status === 'Pending' ||
      e.payment_status === 'Paid' ||
      (e.payment_status === 'Waitlisted' &&
        e.waitlist_offer_expires_at != null &&
        new Date(e.waitlist_offer_expires_at).getTime() > now)
  ).length
}

export async function GET(request: Request, ctx: RouteContext<'/api/class-info/[id]'>) {
  const { id } = await ctx.params

  const { data: cls } = await supabase
    .from('classes')
    .select(
      `id, slug, status, class_type, price, capacity,
       start_date, default_location, registration_close_date, school_id, delivery_mode,
       timezone, display_cities, promo_code, marketing_url, schools ( name, nickname, timezone, city ),
       sessions ( id, session_date, start_time, end_time, location ),
       enrollments ( payment_status, waitlist_offer_expires_at )`
    )
    .eq(UUID_RE.test(id) ? 'id' : 'slug', id)
    .single()

  if (!cls) {
    return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  }

  // PL-307: at-HGL classes show the domestic tiers, everything else the
  // international ones — same rule the checkout re-validates server-side.
  const { data: pkgs } = await supabase
    .from('tutoring_packages')
    .select('id, name, hours, hourly_rate, package_price, regular_hourly_rate')
    .eq('phase', 'pre_class')
    .eq('active', true)
    .eq('tier', classTutoringTier(cls as { school_id: string | null; delivery_mode: string | null }))
    .order('hours')

  // The promo code itself never rides the public payload — only whether a
  // "have a discount code?" field is worth showing (PL-279).
  // PL-328: delivery_mode stays in the public payload (families see
  // online/in-person anyway; the calendar page's label needs it). school_id
  // stays internal.
  const { enrollments, capacity, promo_code, school_id, ...publicClass } =
    cls as typeof cls & {
      enrollments: Slot[]
      capacity: number
      promo_code: string | null
      school_id: string | null
    }
  void school_id

  // PL-279: the emailed auto-apply link carries ?fo=<token>&fe=<enrollment>.
  // Validation is per-cohort (the recipient's feeder class schedule); an
  // aged-out link degrades to a plain refusal string the page can show.
  const url = new URL(request.url)
  const foTokenParam = url.searchParams.get('fo')
  const feParam = url.searchParams.get('fe')
  let followOnDiscount: { amount: number; code: string; endDate: string } | null = null
  let followOnDiscountNote: string | null = null
  if (foTokenParam && feParam) {
    const verdict = await validateFollowOnDiscount({
      classId: (cls as { id: string }).id,
      token: foTokenParam,
      feederEnrollmentId: feParam,
    })
    if (verdict.ok) {
      followOnDiscount = { amount: verdict.amount, code: verdict.code, endDate: verdict.endDate }
    } else {
      followOnDiscountNote = verdict.reason
    }
  }

  // Cancelled classes read as full-with-no-waitlist on the public page
  // (PHASE4_SPEC §12: better than a cancellation notice).
  const cancelled = (cls as { status?: string }).status === 'cancelled'

  // PL-357: the registration flow's second-page upsell copy renders from
  // the flow-only content block (ONE source — edits on Settings → Class
  // pages reach families). Absent block/table degrades to no pitch copy.
  let upsellPitchMarkdown: string | null = null
  try {
    const { data: pitch } = await supabase
      .from('site_content_blocks')
      .select('body_markdown')
      .eq('key', 'one-on-one-pitch')
      .maybeSingle()
    upsellPitchMarkdown = pitch?.body_markdown ?? null
  } catch {
    upsellPitchMarkdown = null
  }

  return NextResponse.json({
    ...publicClass,
    cancelled,
    isFull: cancelled || spotsTakenRaw(enrollments ?? []) >= capacity,
    packages: pkgs ?? [],
    promoAvailable: Boolean(promo_code?.trim()),
    followOnDiscount,
    followOnDiscountNote,
    upsellPitchMarkdown,
  })
}
