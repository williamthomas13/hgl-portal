# HGL Portal — Phase 6 Spec: QuickBooks Online Integration

**Version:** 1.0 draft · July 7, 2026 · Companion to hgl-portal-master-spec.md
**Goal:** Every successful Stripe payment in the portal is automatically recorded in QuickBooks Online, eliminating manual accounting reconciliation for group classes and tutoring add-ons. Refunds flow through too. QuickBooks remains the system of record for accounting — the portal never becomes an accounting tool.

---

## 1. Scope

**In scope**
- Auto-create a QBO **Sales Receipt** for each paid enrollment (class + optional tutoring add-on as separate line items).
- Auto-create a QBO **Refund Receipt** when a payment is refunded in the Stripe dashboard.
- Per-family QBO Customer records (created/matched by parent email).
- Admin-only "Connect QuickBooks" OAuth flow + connection health indicator.
- Sync-status visibility in admin (per enrollment: synced / pending / failed) with a manual "Retry sync" action.
- Idempotency guarantees — a payment can never be double-recorded.
- QBO sandbox testing end-to-end before live connection.

**Out of scope (explicitly)**
- Payout/fee reconciliation automation (Stripe fees, bank deposits) — see §7 for the recommended manual pattern; can become Phase 6.1 if it's painful.
- Invoicing, estimates, bills, payroll — never.
- Squarespace shop orders — that Stripe account is untouched; whatever process handles it today continues.
- Historical backfill is optional (see §10).

## 2. Why Sales Receipts (not Invoices)

Payment happens at the moment of sale via Stripe Checkout — there's never an outstanding balance. QBO's Sales Receipt is the object for "sold and paid simultaneously." Invoices would create artificial A/R noise.

## 3. Data model additions

- **qbo_connection** (single row): `realm_id`, `access_token`, `refresh_token`, `access_expires_at`, `refresh_expires_at`, `connected_by`, `connected_at`, `status` (connected | expired | disconnected). Tokens encrypted at rest (Supabase Vault or pgcrypto).
- **qbo_item_map**: portal product key → QBO Item ID. Two keys: `group_class` → Item posting to income account **408-3 International Test Prep**; `tutoring_addon` → Item posting to **408-5 International Online Prep**. (Income-account assignment lives on the QBO Item itself; the portal only maps to Item IDs.) Editable in admin settings (dropdown populated from QBO Items API).
- **qbo_sync_log**: `id`, `enrollment_id` FK, `stripe_payment_intent_id`, `kind` (sale | refund), `qbo_doc_id`, `qbo_doc_number`, `status` (pending | synced | failed), `attempts`, `last_error`, `created_at`, `synced_at`. Unique constraint on (`stripe_payment_intent_id`, `kind`) — this is the idempotency backbone.
- **families**: `qbo_customer_id` (nullable text).

## 4. Sync flow — sales

1. Stripe webhook (`checkout.session.completed`) marks enrollment Paid (existing behavior, unchanged) and inserts a `qbo_sync_log` row with status `pending`. The webhook never blocks on QBO — QBO downtime must never affect checkout.
2. A worker (Vercel cron every 5 min, or trigger-then-cron-sweep) processes pending rows:
   - Find-or-create QBO Customer by parent email; store `qbo_customer_id` on the family. DisplayName: `{parentFirstName} {parentLastName} ({email})` to survive QBO's unique-name rule.
   - Build Sales Receipt: line 1 = class (mapped QBO Item, class price, description `"{schoolNickname} {classType} — {studentFirstName} {studentLastName}"`); line 2 (if add-on) = tutoring package (mapped item, add-on price, description with hours). `PrivateNote` = Stripe PaymentIntent ID + portal enrollment URL. `TxnDate` = paid_at (school-local date). Deposit-to account = **Stripe Clearing** (see §7).
   - On success: status `synced`, store doc id/number.
   - On failure: increment attempts, exponential backoff, max 5 attempts → status `failed` + immediate admin alert email (joins the existing admin-notification system from Phase 2 §10).

## 5. Sync flow — refunds

- New Stripe webhook event: `charge.refunded`. Match to enrollment via PaymentIntent ID.
- Insert `qbo_sync_log` row (`kind: refund`) → worker creates a QBO **Refund Receipt** referencing the same customer and items, amount = refunded amount. **Refund lines split by product:** if the refund covers the class, the tutoring add-on, or both, the Refund Receipt carries a separate line per refunded component against the matching QBO Item, so the books show exactly what was refunded. Attribution rule: the portal knows the class price and add-on price for the enrollment, so the refund amount is matched against them — full class amount → class line; full add-on amount → add-on line; class + add-on total → both lines; any other partial amount → single line against the class item, with the amount flagged in `PrivateNote` for the bookkeeper to review.
- This pairs with the existing operational flow (Phase 3.1): staff marks enrollment Refunded in portal, money moves in Stripe dashboard, and now the accounting record follows automatically.

## 6. Auth & connection management

- QBO OAuth2. Access tokens last ~1h, refresh tokens ~100 days but rotate on each refresh — the worker refreshes proactively when access token is within 10 min of expiry and always persists the new refresh token atomically.
- **Admin-only** settings page: Connect / Reconnect / Disconnect, connection status, realm (company) name, and the item-mapping table. Managers have no access (consistent with Phase 3.1 boundaries). Connecting/disconnecting the accounting integration is ownership-level.
- If refresh fails (revoked / 100-day lapse): connection → `expired`, pending syncs pause (not fail), admin alerted daily until reconnected. On reconnect, the worker drains the backlog.
- Env vars: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` (both Sensitive in Vercel), `QBO_ENVIRONMENT` (sandbox | production), `QBO_REDIRECT_URI`.

## 7. Fees, payouts, and the Stripe Clearing account

Recommended bookkeeping pattern (v1 keeps this manual/bank-feed-driven):

- Sales Receipts deposit into a QBO bank-type account called **Stripe Clearing** at **gross** amounts.
- Stripe payouts land in the real bank account via QBO's bank feed; the bookkeeper records each payout as a transfer from Stripe Clearing + a Stripe-fee expense for the difference. Stripe Clearing should reconcile to the Stripe balance.
- Rationale: gross revenue reporting stays accurate per class/school, fees are visible as an expense, and we avoid building payout-report parsing in v1. If the manual payout entry becomes tedious, Phase 6.1 automates it from Stripe `payout.paid` events + the balance-transactions API.

## 8. Admin UI

- Enrollment detail/roster rows show a small QBO badge: ✓ synced (links to the QBO doc), ⏳ pending, ✗ failed (with error + Retry button).
- Settings → QuickBooks: connection card, item mapping, and a filterable sync log (last 90 days) with bulk retry.

## 9. Testing plan

1. QBO **sandbox company** + Stripe test mode: full cycle — checkout with add-on → Sales Receipt with two lines appears; refund in Stripe test dashboard → Refund Receipt appears; duplicate webhook delivery → exactly one receipt (idempotency); QBO token revoked mid-run → backlog pauses and drains on reconnect.
2. Live cutover checklist: create Stripe Clearing account + Items in real QBO company → set mappings → `QBO_ENVIRONMENT=production` → connect via admin → one real $1-style smoke test (or first real registration monitored) → confirm with bookkeeper that the receipt lands in the right accounts.

## 10. Optional backfill

One-time admin-triggered script: create Sales Receipts for historical Paid enrollments since a chosen start date (default: whatever date the bookkeeper says the books currently cover manually — must be confirmed to avoid double-entry). Skippable entirely if books are already current.

## 11. Decisions logged (July 7, 2026)

1. **Chart of accounts:** class revenue → **408-3 International Test Prep**; 1-on-1 tutoring add-ons → **408-5 International Online Prep**. Set on the QBO Items during live cutover (§9).
2. **Customers:** per-family QBO Customer records, matched/created by parent email.
3. **Sales tax:** none. No tax codes on receipts.
4. **Currency:** all USD; single-currency QBO company. If EU settlement methods (SEPA/iDEAL) are later enabled and settle in EUR, revisit before enabling — out of scope here.
5. **Backfill:** skipped entirely. Sync begins with the first payment after go-live.
6. **Refund lines:** split per component (class item / tutoring item) so refunded amounts are attributable — see §5 for the attribution rule.
