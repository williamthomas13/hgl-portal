import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'

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
       start_date, default_location, registration_close_date,
       schools ( name, nickname, timezone ),
       sessions ( id, session_date, start_time, end_time, location ),
       enrollments ( payment_status, waitlist_offer_expires_at )`
    )
    .eq(UUID_RE.test(id) ? 'id' : 'slug', id)
    .single()

  if (!cls) {
    return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
  }

  const { data: pkgs } = await supabase
    .from('tutoring_packages')
    .select('id, name, hours, hourly_rate, package_price, regular_hourly_rate')
    .eq('phase', 'pre_class')
    .eq('active', true)
    .order('hours')

  const { enrollments, capacity, ...publicClass } = cls as typeof cls & {
    enrollments: Slot[]
    capacity: number
  }

  // Cancelled classes read as full-with-no-waitlist on the public page
  // (PHASE4_SPEC §12: better than a cancellation notice).
  const cancelled = (cls as { status?: string }).status === 'cancelled'

  return NextResponse.json({
    ...publicClass,
    cancelled,
    isFull: cancelled || spotsTakenRaw(enrollments ?? []) >= capacity,
    packages: pkgs ?? [],
  })
}
