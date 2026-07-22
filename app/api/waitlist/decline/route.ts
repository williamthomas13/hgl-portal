import { NextResponse, after } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { ADMIN_EMAIL, loadClassBundles, verifyDeclineToken } from '../../../utils/lifecycle'
import { sendAdminAlert } from '../../../utils/email'
import { extendWaitlistOffers } from '../../../utils/waitlist-offers'

// PL-72: confirmed early decline of an offered waitlist spot. POST-only (the
// emailed GET lands on the confirm page; a scanner can never reach this) and
// idempotent. On success the enrollment moves to Expired with a declined
// stamp (the admin panel shows "Declined offer", not "expired unclaimed"),
// the family joins the interest list (declining costs nothing — the WR/PL-54
// principle), and the SAME cascade the deadline expiry runs fires
// immediately: the next family gets their W2 with a fresh 48h clock.

export async function POST(req: Request) {
  let body: { enrollmentId?: string; token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { enrollmentId, token } = body
  if (!enrollmentId || !token || !verifyDeclineToken(enrollmentId, token)) {
    return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 403 })
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id, class_id, payment_status, waitlist_offer_sent_at, waitlist_declined_at')
    .eq('id', enrollmentId)
    .maybeSingle()
  if (!enrollment) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 })
  if (enrollment.waitlist_declined_at) return NextResponse.json({ ok: true, already: true })
  if (enrollment.payment_status !== 'Waitlisted' || !enrollment.waitlist_offer_sent_at) {
    return NextResponse.json(
      { error: 'This offer already ended — the spot moved to the next family.' },
      { status: 410 }
    )
  }

  // Guarded flip: a concurrent claim/expiry wins over the decline.
  const nowIso = new Date().toISOString()
  const { data: flipped } = await supabase
    .from('enrollments')
    .update({ payment_status: 'Expired', waitlist_declined_at: nowIso })
    .eq('id', enrollmentId)
    .eq('payment_status', 'Waitlisted')
    .select('id')
  if (!flipped || flipped.length === 0) {
    return NextResponse.json(
      { error: 'This offer just changed — reload the page or reply to our email.' },
      { status: 409 }
    )
  }

  const [bundle] = await loadClassBundles(enrollment.class_id)
  const e = bundle?.enrollments.find((x) => x.id === enrollmentId)

  // Interest row stays — they still hear when a future class opens.
  if (bundle && e) {
    await supabase
      .from('class_interest')
      .upsert(
        [
          {
            email: e.parentEmail.toLowerCase(),
            parent_name: e.parentFirstName || null,
            student_name: `${e.studentFirstName} ${e.studentLastName}`.trim() || null,
            school_id: bundle.schoolId,
            class_type: bundle.classType,
            source: 'cancellation',
          },
        ],
        { onConflict: 'email,school_id,class_type', ignoreDuplicates: true }
      )
      .then(({ error }) => {
        if (error) console.error('decline interest upsert failed (decline stands):', error.message)
      })

    // Log like the deadline path does — same alert family, honest subject.
    await sendAdminAlert({
      dedupeKey: `offer_declined:${enrollmentId}`,
      adminEmail: ADMIN_EMAIL,
      templateKey: 'AL_WAITLIST_ROLLOVER',
      vars: { schoolNickname: bundle.schoolLabel, classType: bundle.classType },
      subject: `Waitlist spot declined — ${bundle.schoolLabel} ${bundle.classType}`,
      body: `<p>${e.parentFirstName} (${e.parentEmail}, student ${e.studentFirstName}
        ${e.studentLastName}) released their offered spot early. The offer cascades to the next
        family immediately with a fresh 48-hour clock.</p>`,
      enrollmentId,
    }).catch((err) => console.error('decline alert failed (decline stands):', err))

    // The cascade — same pass the cron runs, right now. In-memory state
    // already reflects the flip via the guarded update above; reload to be
    // exact, then extend behind the response.
    after(async () => {
      try {
        const [fresh] = await loadClassBundles(enrollment.class_id)
        if (fresh) await extendWaitlistOffers(fresh)
      } catch (err) {
        console.error('decline cascade failed (cron will catch up):', err)
      }
    })
  }

  return NextResponse.json({ ok: true })
}
