import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin as supabase } from "../../utils/supabase-admin"

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
    }: {
      enrollmentId?: string;
      enrollmentIds?: string[];
      packageId?: string | null;
      /** enrollmentId → packageId (or null) for sibling carts. */
      packageSelections?: Record<string, string | null>;
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
         classes ( id, price, class_type, schools ( nickname ) ),
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
    const price = Number(cls.price);
    const customerEmail: string = family.parent_email;
    const schoolLabel = one<{ nickname?: string }>(cls.schools)?.nickname ?? 'HGL';
    const className = `${schoolLabel} — ${cls.class_type}`;

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
          .select('id, name, package_price, phase, active')
          .eq('id', selectedPkg)
          .eq('phase', 'pre_class')
          .eq('active', true)
          .single();
        if (pkgError || !pkg) {
          return NextResponse.json({ error: 'Tutoring package not found.' }, { status: 400 });
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
      allow_promotion_codes: true,
      line_items: lineItems,
      mode: 'payment',
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/register/${classId}?canceled=1`,
      // The critical link: Stripe carries these identifiers back on the webhook,
      // so we can update the exact enrollment(s) regardless of email collisions.
      metadata,
    });

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
