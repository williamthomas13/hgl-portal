# Phase 6 Launch Runbook — QuickBooks Online Integration

Companion to docs/PHASE6_SPEC.md. Code is complete and committed; these are
the steps only you can do, in order. Nothing syncs (and nothing breaks) until
they're done — the webhook enqueues fail soft and checkout is unaffected.

## 1. Apply the migration — BEFORE pushing/deploying the code

`supabase/migrations/20260711000001_phase6_qbo.sql` (idempotent, safe to
re-run). **Deploy order matters**: the new admin page embeds `qbo_sync_log`
in the roster query, so deploying the code without the migration breaks the
admin roster view (the old code tolerates the migration fine).

After applying: check Supabase **Security Advisor shows zero findings**
(standing post-migration rule). Expected posture: `qbo_connection` RLS on
with **no** policies (service-role only — tokens never reach a browser);
`qbo_item_map` staff-read/admin-write; `qbo_sync_log` staff-read.

## 2. Create the Intuit developer app

1. https://developer.intuit.com → sign in (any Intuit account works; consider
   the same one that owns the real QBO company) → **Create an app** →
   QuickBooks Online and Payments → scope: **com.intuit.quickbooks.accounting**.
2. Under the app's **Development** keys: copy Client ID + Client Secret.
3. Add BOTH redirect URIs (exact match required):
   - `https://hgl-portal.vercel.app/api/qbo/callback`
   - `http://localhost:3000/api/qbo/callback` (local testing)
4. A **sandbox company** comes free with the developer account
   (Dashboard → Sandbox) — that's what we test against in §5.

## 3. Vercel env vars (then redeploy — env changes need one)

| Var | Value |
| --- | --- |
| `QBO_CLIENT_ID` | from the Intuit app (Development keys for now) — mark Sensitive |
| `QBO_CLIENT_SECRET` | same — mark Sensitive |
| `QBO_ENVIRONMENT` | `sandbox` (flip to `production` at cutover, §6) |
| `QBO_REDIRECT_URI` | `https://hgl-portal.vercel.app/api/qbo/callback` |

Also add all four to `.env.local` for local testing (with the localhost
redirect URI there).

Note: stored QBO tokens are encrypted with a key derived from `CRON_SECRET` —
if `CRON_SECRET` is ever rotated, the connection shows **expired** and one
click of Reconnect fixes it.

## 4. Stripe: subscribe the webhook to `charge.refunded`

Dashboard → Developers → Webhooks → the portal endpoint → add event
**`charge.refunded`** (keep `checkout.session.completed`). Test-mode and
live-mode endpoints are separate — do BOTH (live one exists only after the
live-mode switch from SPEC §13).

## 5. Sandbox end-to-end test (spec §9.1)

1. In the **sandbox company** (sandbox.qbo.intuit.com): create two Service
   Items — e.g. "Group Class" and "1-on-1 Tutoring" (any income accounts) —
   and a **bank-type** account named "Stripe Clearing".
2. `/admin` → QuickBooks panel → **Connect QuickBooks** → approve → panel
   shows Connected + company name, SANDBOX badge.
3. **Load options from QuickBooks** → map all three rows (group class item,
   tutoring item, deposit account). Syncs wait until all mapped.
4. Stripe **test mode**: register + pay for a test class **with a tutoring
   add-on** → within a minute the enrollment shows **QBO ✓** and the Sales
   Receipt (two lines, deposited to Stripe Clearing) opens from the badge.
5. Refund the payment in the Stripe test dashboard → `charge.refunded` →
   Refund Receipt appears (line per refunded component); also mark the
   enrollment Refunded in the portal as usual (that flow is unchanged).
6. Idempotency: resend the `checkout.session.completed` event from the
   Stripe dashboard → still exactly one Sales Receipt.
7. Pause/drain: Disconnect in the panel → make another test payment → row
   sits ⏳ pending → Reconnect → it syncs on the next trigger/hourly sweep
   (or hit Retry).
8. Clean up test fixtures from the DB as usual.

## 6. Live cutover checklist (spec §9.2)

1. In the **real** QBO company (bookkeeper): create the two Items —
   group class Item posting to **408-3 International Test Prep**, tutoring
   Item posting to **408-5 International Online Prep** — and the
   **Stripe Clearing** bank account.
2. Intuit app → **Production** keys (fill in the app's required production
   fields/questionnaire to unlock them) and make sure the production
   redirect URI is listed there too.
3. Vercel: swap `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET` to the production keys,
   set `QBO_ENVIRONMENT=production`, redeploy.
4. `/admin` → Connect (now against the real company) → re-map the three
   rows against the real Items/account (mappings are per-company ids —
   the sandbox ones don't carry over).
5. First real payment (or a $1-style smoke test): watch the Sales Receipt
   land, then confirm with the bookkeeper it posts to the right accounts.
6. Bookkeeper workflow from here (spec §7): receipts deposit **gross** into
   Stripe Clearing; each Stripe payout in the bank feed is recorded as a
   transfer from Stripe Clearing + a Stripe-fee expense; Stripe Clearing
   reconciles to the Stripe balance.

## 7. Operating notes

- **No backfill** (decision §11.5): sync starts with the first payment after
  go-live. Pre-Phase-6 enrollments show no QBO badge — that's expected.
- **Failures**: 5 attempts with backoff, then the row goes ✗ failed + you get
  an alert email; fix the cause and hit Retry in the panel.
- **Expired connection** (~100-day refresh window or revoked): syncs pause
  (never fail), daily alert email until someone reconnects, backlog drains
  automatically.
- **Second partial refund on the same payment**: one Refund Receipt per
  payment is the idempotency rule — an additional refund triggers an alert
  email to enter it in QBO manually.
- **Promo codes**: the Sales Receipt carries the full line prices plus a
  discount line, so the total equals the money that actually moved.
- **Addon-only purchases** (the #9 upsell page) are their own payment and get
  their own Sales Receipt with just the tutoring line.
- Managers see the sync log and can retry; only admins can connect,
  disconnect, or change the mapping (spec §6).
