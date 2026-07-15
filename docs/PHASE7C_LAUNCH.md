# Phase 7c Launch Runbook — Monthly Tutoring Billing

Companion to docs/PHASE7_SPEC.md §6. Code complete; these are the steps only
you (and the bookkeeper) can do. Ordering matters: migration first, then the
Stripe dashboard bits; QBO items can lag (sync rows just wait, fail-soft).

## 1. Apply the migration — BEFORE deploying the code

`supabase/migrations/20260716000001_phase7c_billing.sql` (idempotent).
Adds `app_settings` (cycle days + the contact block — edit values there, not
code), invoice cycle columns, extends `qbo_sync_log` for tutoring (additive:
Phase 6 class rows untouched), and the two tutoring keys on `qbo_item_map`.

After applying: Security Advisor zero errors (standing rule). Expected:
`app_settings` staff-only; everything else unchanged posture.

## 2. Stripe test-mode dashboard (the current sandbox)

1. **Enable ACH Direct Debit:** Settings → Payments → Payment methods →
   enable **US bank account (ACH Direct Debit)** for the account. (Per-mode
   setting — repeat in live mode at cutover.)
2. **Webhook endpoint events:** on the existing TEST endpoint pointing at
   `https://hgl-portal.vercel.app/api/webhook`, add these events:
   - `invoice.paid`
   - `invoice.payment_failed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   (`checkout.session.completed` + `charge.refunded` are already on.) The
   handlers filter by tutoring metadata, so class-checkout traffic through
   the same events is ignored safely.
3. Nothing else — hosted invoices and setup-mode Checkout need no product
   or price objects; everything is created ad-hoc per invoice.

## 3. QuickBooks Items — for the bookkeeper (can lag; rows queue)

Create (or confirm) **two service Items** in the real QBO company, then map
them in the /admin QuickBooks panel (admin-only, same as Phase 6):

| qbo_item_map key      | Suggested Item name          | Income account                  |
|-----------------------|------------------------------|---------------------------------|
| `tutoring_test_prep`  | HGL 1-on-1 Test Prep         | **408-1** (test-prep tutoring)  |
| `tutoring_subject`    | HGL 1-on-1 Subject Tutoring  | **401** (subject tutoring)      |

For SANDBOX testing first: create the same two items in the sandbox company
(the Phase 6 provisioning pattern works) and map them; re-map at live
cutover exactly like the Phase 6 items. `deposit_account` (Stripe Clearing)
is shared and already mapped.

## 4. What the cycle does (so QA reads right)

- **Generation** (cron, the 20th Denver; `app_settings.tutoring_generate_day`):
  next month's sessions materialize as *proposed* (no Google events yet),
  one draft invoice per family (multi-student combined), package hours
  drawn down first, prior-month late-reschedule fees ($40/hour) carried on.
  T1 goes to billing_email CC billing_cc_emails with the signed schedule link.
- **T1b nudge** at +2 days; **auto-confirm** at +5 (both settings). An open
  change request pauses the auto-confirm clock until marked handled.
- **Confirm** (parent click, staff on their behalf, or auto): sessions flip
  confirmed → Google push; invoice → collection. Autopay families: off-session
  charge (3 attempts over a week → past due + Ops alert + pay-by-link).
  Others: Stripe hosted invoice (card + ACH), due month-end, T2 wraps the link.
- **Escalation:** +10 days past due → reminder + Ops alert; +30 days → the
  10% late-fee flag (a button on the Billing panel — staff-applied, never
  automatic).
- **Paid** (webhook) → QBO Sales Receipt via the Phase 6 queue, lines split
  by subject category.

## 5. Sandbox QA script

1. Billing panel → "Run the monthly cycle now" with a test month (the QA
   engagement works) → T1 lands; open the schedule page from the email.
2. **Request changes** → Ops alert arrives, auto-confirm pauses; mark handled.
3. **Confirm** → sessions confirmed + on the tutor's Google Calendar;
   hosted invoice + T2 arrive (family has autopay off).
4. Pay the hosted invoice with Stripe's test card (4242…) — and separately
   with the **test bank account** (search "test bank numbers" in Stripe docs;
   ACH settles after a simulated delay) → invoice flips paid → QBO Sales
   Receipt appears in the sandbox company under the right item.
5. Autopay: open the T2 email's autopay link → consent → save `4242` card →
   next cycle's confirm charges automatically; kill the card
   (`4000 0000 0000 0341`) to watch T4 dunning → 3 attempts → past due +
   pay-by-link fallback.
6. Late fee: on a past-due invoice 30+ days old the flag appears; apply →
   invoice re-issues with the 10% line.

## 6. Before a LIVE test

- Live-mode Stripe: enable ACH (per-mode), add the four events to the LIVE
  webhook endpoint, and confirm `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
  on Vercel are the live pair (same env vars as classes — flipping modes
  flips both products at once; plan the cutover together with Phase 6's).
- Bookkeeper confirms the two live QBO Items and the mapping (§3).
- Policy text: the agreements doc (7e) should match §6 wording (due
  month-end; 10-day/30-day; $40/hour; auto-confirm window) before families
  see live invoices.
