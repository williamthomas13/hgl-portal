import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin as supabase } from "../../utils/supabase-admin"
import { validateFollowOnDiscount } from '../../utils/follow-on'
import { classTutoringTier } from '../../utils/tutoring-tier'
import { printfulConfigured, printfulCountries } from '../../utils/printful'

// Stripe client. We don't pin apiVersion here — the installed SDK
// version ships with a default that matches its TypeScript types.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// PostgREST returns to-one embeds as object or single-element array
// depending on the relationship metadata — normalize.
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // PL-125: sibling checkout — ONE Stripe session, a line item per
    // student (+ any per-student add-on), the family pays once. The legacy
    // single-enrollment body keeps working (normalizes to a one-item list).
    const {
      enrollmentId,
      enrollmentIds,
      packageId,
      packageSelections,
      foToken,
      foEnrollmentId,
      discountCode,
      products: productPicks,
      shipping,
    }: {
      enrollmentId?: string;
      enrollmentIds?: string[];
      packageId?: string | null;
      /** enrollmentId → packageId (or null) for sibling carts. */
      packageSelections?: Record<string, string | null>;
      /** PL-279: the emailed auto-apply token (+ its feeder enrollment). */
      foToken?: string | null;
      foEnrollmentId?: string | null;
      /** PL-279: the typed-code fallback. */
      discountCode?: string | null;
      /** PL-364: physical add-on picks — server re-prices from the products table. */
      products?: { productId: string; quantity: number }[];
      /** PL-364: shipping address — required when a physical product is in the order. */
      shipping?: {
        name?: string; address1?: string; address2?: string;
        city?: string; state?: string; zip?: string; country?: string;
      };
    } = body;

    const ids: string[] = Array.isArray(enrollmentIds) && enrollmentIds.length > 0
      ? [...new Set(enrollmentIds.map(String))]
      : enrollmentId
        ? [enrollmentId]
        : [];
    if (ids.length === 0 || ids.length > 6) {
      return NextResponse.json(
        { error: 'Missing enrollmentId — can\'t reliably track payment back to enrollment.' },
        { status: 400 }
      );
    }
    const pkgFor = (id: string): string | null =>
      packageSelections ? (packageSelections[id] ?? null) : ids.length === 1 ? (packageId ?? null) : null;

    // Everything the checkout session needs comes from the DB, never the
    // client: price, product name, and billing email (Phase 3 hardening).
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: enrs } = await supabase
      .from('enrollments')
      .select(
        `id, payment_status, class_id,
         classes ( id, price, class_type, school_id, delivery_mode, schools ( nickname ) ),
         students ( first_name, families ( id, parent_email ) )`
      )
      .in('id', ids);
    if (!enrs || enrs.length !== ids.length) {
      return NextResponse.json({ error: 'Registration not found.' }, { status: 404 });
    }
    const first = enrs[0] as any;
    const cls = one<any>(first.classes);
    const family = one<any>(one<any>(first.students)?.families);
    if (!cls || !family) {
      return NextResponse.json({ error: 'Registration not found.' }, { status: 404 });
    }
    // Sibling carts must be one class, one family — no mixed carts.
    for (const e of enrs as any[]) {
      if (one<any>(e.classes)?.id !== cls.id) {
        return NextResponse.json({ error: 'All students must be on the same class.' }, { status: 400 });
      }
      if (one<any>(one<any>(e.students)?.families)?.id !== family.id) {
        return NextResponse.json({ error: 'All students must belong to the same family.' }, { status: 400 });
      }
      if (e.payment_status === 'Paid' || e.payment_status === 'Completed') {
        return NextResponse.json({ error: 'This registration is already paid.' }, { status: 400 });
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const classId: string = cls.id;
    let price = Number(cls.price);
    const customerEmail: string = family.parent_email;
    const schoolLabel = one<{ nickname?: string }>(cls.schools)?.nickname ?? 'HGL';
    let className = `${schoolLabel} — ${cls.class_type}`;

    // PL-279: the follow-on discount — validated SERVER-SIDE against the
    // registering family's own cohort (token path or typed code), never
    // trusted from the client. Applies per student to the class component.
    // An invalid/expired code refuses the checkout with the plain reason
    // rather than silently charging full price.
    if ((foToken && foEnrollmentId) || discountCode) {
      const verdict = await validateFollowOnDiscount({
        classId,
        token: foToken ?? null,
        feederEnrollmentId: foEnrollmentId ?? null,
        code: discountCode ?? null,
        parentEmail: customerEmail,
      });
      if (!verdict.ok) {
        // PL-431B: the client renders this INLINE at the discount field and
        // keeps the flow continuable — never a full-stop checkout error.
        return NextResponse.json({ error: verdict.reason, discountError: true }, { status: 400 });
      }
      const discounted = Math.max(0, price - verdict.amount);
      className = `${className} (${verdict.code} — $${verdict.amount.toFixed(0)} off)`;
      price = discounted;
      // PL-280: record the code used — the "used a promo code" segment chip
      // reads this (Stripe-page promotion codes are invisible to us).
      await supabase.from('enrollments').update({ promo_code_used: verdict.code }).in('id', ids);
    }

    // Base URL for redirects. Set NEXT_PUBLIC_APP_URL in env
    // (local: http://localhost:3000, production: https://hgl-portal.vercel.app
    // or eventually https://portal.highergroundlearning.com).
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      'http://localhost:3000';

    type LineItem = { price_data: { currency: string; product_data: { name: string }; unit_amount: number }; quantity: number };
    const lineItems: LineItem[] = [];
    // Per-enrollment charge total — the webhook stamps THIS on each row
    // (amount_paid must never carry a sibling's money: the PL-116 lesson).
    const perEnrollmentTotal: Record<string, number> = {};
    // PL-142: the component prices as the family sees them RIGHT NOW. These
    // ride the enrollment to payment and become the receipt's authority, so
    // a later price edit can never rewrite what someone already paid.
    const perEnrollmentAddonPrice: Record<string, number> = {};

    for (const raw of enrs as any[]) {
      const e = raw;
      const studentFirst = one<any>(e.students)?.first_name ?? '';
      const label = ids.length > 1 && studentFirst ? `${className} — ${studentFirst}` : className;
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: label },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      });
      perEnrollmentTotal[e.id] = price;

      // Optional pre-class tutoring add-on: a line item beside its student.
      // Price always comes from the packages table — never from the client.
      const selectedPkg = pkgFor(e.id);
      if (selectedPkg) {
        const { data: pkg, error: pkgError } = await supabase
          .from('tutoring_packages')
          .select('id, name, package_price, phase, active, tier')
          .eq('id', selectedPkg)
          .eq('phase', 'pre_class')
          .eq('active', true)
          .single();
        if (pkgError || !pkg) {
          return NextResponse.json({ error: 'Tutoring package not found.' }, { status: 400 });
        }
        // PL-307: the package's tier must match the class flavor — the same
        // rule class-info used to build the dropdown, re-checked here so a
        // stale or hand-crafted package id can't buy the wrong price sheet.
        if (pkg.tier !== classTutoringTier(cls)) {
          return NextResponse.json(
            { error: 'That tutoring package doesn’t apply to this class — reload the page and pick again.' },
            { status: 400 }
          );
        }
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${pkg.name} — 1-on-1 Tutoring${ids.length > 1 && studentFirst ? ` (${studentFirst})` : ''}`,
            },
            unit_amount: Math.round(Number(pkg.package_price) * 100),
          },
          quantity: 1,
        });
        perEnrollmentTotal[e.id] += Number(pkg.package_price);
        perEnrollmentAddonPrice[e.id] = Number(pkg.package_price); // PL-142
      }
    }

    // PL-364: physical add-on products — server-priced, shipping address
    // required, coverage checked against Printful's own country list so an
    // unsupported destination refuses HERE, never at fulfillment. Product
    // money rides the FIRST enrollment's cart total (one family, one cart);
    // the product_orders rows carry the per-product money facts.
    const pickedProducts: { row: any; quantity: number }[] = [];
    if (Array.isArray(productPicks) && productPicks.length > 0) {
      if (!printfulConfigured()) {
        return NextResponse.json(
          { error: 'Physical add-ons are not available right now.' },
          { status: 400 }
        );
      }
      for (const pick of productPicks) {
        const qty = Math.trunc(Number(pick?.quantity));
        if (!pick?.productId || !(qty >= 1) || qty > 10) continue;
        const { data: prod } = await supabase
          .from('products')
          .select('id, name, price, regular_price, physical, active')
          .eq('id', pick.productId)
          .eq('active', true)
          .maybeSingle();
        if (!prod) {
          return NextResponse.json({ error: 'Product not found — reload the page and pick again.' }, { status: 400 });
        }
        pickedProducts.push({ row: prod, quantity: qty });
      }
      const anyPhysical = pickedProducts.some((p) => p.row.physical);
      if (anyPhysical) {
        const s = shipping ?? {};
        if (!s.name?.trim() || !s.address1?.trim() || !s.city?.trim() || !s.country?.trim()) {
          return NextResponse.json(
            { error: 'A shipping address (name, street, city, country) is needed for the notebook order.' },
            { status: 400 }
          );
        }
        const countries = await printfulCountries();
        if (countries.length > 0 && !countries.some((c) => c.code === s.country)) {
          return NextResponse.json(
            { error: `We can't ship notebooks to that country yet — remove the physical add-on to register, or contact us and we'll figure something out.` },
            { status: 400 }
          );
        }
      }
      const primary = ids[0];
      for (const p of pickedProducts) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `${p.row.name}${p.quantity > 1 ? ` × ${p.quantity}` : ''}` },
            unit_amount: Math.round(Number(p.row.price) * 100),
          },
          quantity: p.quantity,
        });
        perEnrollmentTotal[primary] = (perEnrollmentTotal[primary] ?? 0) + Number(p.row.price) * p.quantity;
        // One row per enrollment+product — the Printful idempotency unit. A
        // re-checkout (abandoned cart) updates the same row in place.
        const { error: poErr } = await supabase.from('product_orders').upsert(
          {
            enrollment_id: primary,
            product_id: p.row.id,
            quantity: p.quantity,
            price_paid: Number(p.row.price) * p.quantity,
            regular_price_snapshot: p.row.regular_price != null ? Number(p.row.regular_price) : null,
            ship_name: shipping?.name?.trim() ?? null,
            ship_address1: shipping?.address1?.trim() ?? null,
            ship_address2: shipping?.address2?.trim() || null,
            ship_city: shipping?.city?.trim() ?? null,
            ship_state: shipping?.state?.trim() || null,
            ship_zip: shipping?.zip?.trim() || null,
            ship_country: shipping?.country?.trim() ?? null,
            status: 'pending_payment',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'enrollment_id,product_id' }
        );
        if (poErr) {
          console.error('product_orders upsert failed:', poErr.message);
          return NextResponse.json({ error: 'Could not record the notebook order — try again.' }, { status: 500 });
        }
      }
    }

    // Metadata: single carts keep the legacy shape (enrollment_id +
    // package_id) so nothing downstream changes; sibling carts carry the
    // fan-out lists the webhook explodes (comma-joined — well under
    // Stripe's 500-char value limit at the 6-student cap).
    const metadata: Record<string, string> = { class_id: classId };
    if (ids.length === 1) {
      metadata.enrollment_id = ids[0];
      const p = pkgFor(ids[0]);
      if (p) metadata.package_id = p;
    } else {
      metadata.enrollment_ids = ids.join(',');
      metadata.package_ids = ids.map((id) => pkgFor(id) ?? '').join(',');
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: customerEmail,
      // PL-431C: Stripe's own promo box is OFF — portal codes aren't Stripe
      // codes (it rendered but accepted nothing, which misled). One discount
      // entry, ours, validated against the class + the family's own cohort.
      allow_promotion_codes: false,
      line_items: lineItems,
      mode: 'payment',
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/register/${classId}?canceled=1`,
      // The critical link: Stripe carries these identifiers back on the webhook,
      // so we can update the exact enrollment(s) regardless of email collisions.
      metadata,
    });

    // PL-364: stamp the session on the product rows too — the paid webhook
    // flips exactly these to 'queued'.
    if (pickedProducts.length > 0) {
      await supabase
        .from('product_orders')
        .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
        .eq('enrollment_id', ids[0])
        .eq('status', 'pending_payment');
    }

    // Stamp the Stripe session id onto each enrollment immediately so the
    // webhook has a deterministic lookup key. PL-52: the add-on selection and
    // the built per-student total persist HERE, not just in the Stripe
    // session — an abandoned checkout must not evaporate the parent's choice,
    // and /api/resume-payment rebuilds the identical cart from these fields.
    for (const id of ids) {
      const { error: stampError } = await supabase
        .from('enrollments')
        .update({
          stripe_session_id: session.id,
          pending_package_id: pkgFor(id), // explicit null: "no thanks" clears an earlier pick
          pending_checkout_total: perEnrollmentTotal[id] ?? price,
          // PL-142: component snapshots — the receipt's future authority.
          class_price_snapshot: price,
          pending_addon_price: perEnrollmentAddonPrice[id] ?? null,
        })
        .eq('id', id);
      if (stampError) {
        console.error('Failed to stamp stripe_session_id on enrollment:', stampError.message);
        // Not fatal for the user — the webhook can still match on metadata.
      }
    }

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown checkout error';
    console.error('Stripe Checkout error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
