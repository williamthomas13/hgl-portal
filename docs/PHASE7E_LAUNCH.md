# Phase 7e Launch Runbook — Intake & Onboarding + Policy Agreements

Companion to docs/PHASE7_SPEC.md §11–§12. Code complete on branch `phase7e`;
these are the steps only you can do, plus the QA script and the wiring the
main session must connect at merge time.

## 1. Apply the migration — BEFORE deploying the code

`supabase/migrations/20260717000001_phase7e_intake.sql` (idempotent).

Adds:
- **`leads`** — the pipeline that replaces the "pending students" spreadsheet
  (status pipeline, consult fields, full intake answers in `intake` jsonb,
  conversion FKs to families/students).
- **`tutoring_offers`** — the "2 free hours"-style mechanism, seeded EMPTY
  (no offers at launch, per spec §11).
- **`agreement_templates`** — versioned policy text, **seeded with v1** of the
  Scheduling & Billing Policies (updated to match §6: due month-end, 24h/$40
  reschedule rule, 10-day reminder / 30-day 10% late fee, reduced-rate form).
  Review the seeded text on /admin/agreements → Policy versions before
  sending anyone the link; publish a v2 from there if wording needs changes.
- **`agreement_acceptances`** — identity + timestamp + IP + pinned version +
  PDF snapshot path.

RLS: staff full CRUD on all four; parents read their own family's
acceptances; **no anon policies** (public pages go through token-verified
service-role routes). After applying: Security Advisor zero errors
(standing rule).

## 2. Storage bucket — nothing to create

PDF snapshots upload to the **existing private `collateral-private` bucket**
(created in Phase 4.5) under `agreements/{acceptanceId}.pdf`. Staff download
via short-lived signed URLs from /admin/agreements. No bucket or policy
changes needed.

## 3. Environment — nothing new

Tokens sign with the existing `CRON_SECRET` (same scheme as proposal/autopay
links; rotating it invalidates outstanding intake/agreement links — re-send
from the admin pages). PDF rendering uses the existing puppeteer-core /
@sparticuz/chromium setup; emails use the existing Resend config. Consult
calendar push reuses the Phase 7a Google service-account connection — if
GCal isn't connected yet, consults still schedule, just without the calendar
event (the UI says so).

## 4. QA script (test-mode / QA data)

**Leads & intake**
1. /admin → new **Leads** nav link → "Add a lead" (source: phone call, your
   own email as contact). It appears under **New**.
2. Open the lead → **Send intake form** → confirm. Lead moves to **Intake
   form sent**; T7 arrives with the tokenized link.
3. Open the link (logged out / incognito — no login should be asked). Fill
   the form; use a parent email that ALREADY exists as a QA family. Submit.
4. Check: lead is **Intake complete** with all answers on the lead card; NO
   duplicate family row (matched by email); the student row was created (or
   matched) inside the existing family with grade filled; Ops alert email
   arrived. Re-open the intake link — friendly "we already have your
   answers" state.
5. Schedule a consult (datetime + a Workspace email) → event lands on that
   calendar as "Consult: {student} — HGL tutoring"; re-schedule → same event
   moves (patched, not duplicated). With GCal disconnected the save still
   succeeds and the UI notes the push failed.
6. Leave a lead untouched 4+ days (or edit `updated_at` in SQL) → amber
   "no touch in 4+ days" badge.
7. Offers: create one, attach to a lead, detach, deactivate.

**Agreements**
1. /admin/agreements → the QA tutoring family shows **Not accepted**; the
   amber "active tutoring but no accepted agreement" banner lists it.
2. **Send agreement link** → email arrives → open the link, read the seeded
   v1 policy, type a name + check the box → accept.
3. Admin page now shows **Accepted v1** with date; **PDF** opens the signed
   snapshot (policy text + acceptance record incl. IP). If chromium hiccuped,
   a **Retry PDF** button shows instead — acceptance itself is never lost.
4. Re-open the public link → "Already accepted" state (no double records).
5. Publish a v2 (Policy versions → Draft a new version) → family badge flips
   to "current is v2" with a **Send updated policy** chase button; the v1
   acceptance row and its PDF remain intact.

## 5. Integration wiring — for the main session at merge

Phase 7e deliberately does NOT touch the shared engagement/billing code
paths. Two call sites to connect:

1. **T8 welcome/handoff on first engagement creation** (spec §11): in the
   engagement-create path (`/api/admin/tutoring/engagement`, `action:
   'create'`), when the new engagement is the family's FIRST, call
   `sendWelcomeHandoff(engagementId)` from `app/utils/intake-emails.ts`
   (fire-and-forget in `after()`, after the initial sessions are inserted so
   the schedule summary isn't empty). It dedupes on `t8_welcome:{engagementId}`
   and carries the agreements + autopay links, tutor contact, first-month
   schedule, location, and the 24h policy line.
2. **§12 warn-on-generation**: in `generateMonthlyCycle`
   (`app/utils/tutoring-billing.ts`), when building a family's invoice, warn
   (not block) if the family has no row in `agreement_acceptances` — e.g.
   include the family in the generation result / Ops alert. The
   /admin/agreements banner already lists these families; the cycle-time
   warning is belt-and-braces.
3. Optional, when a lead converts: set the lead's `status='scheduled'` and
   `family_id`/`student_id` if the intake form wasn't used (staff can also do
   this by hand on /admin/leads). Offers attached to a converting lead
   materialize on the first invoice **manually for now** (add a credit line
   named after the offer) — no offers are active at launch, so nothing is
   pending on this.

## 6. What ships where (quick map)

- `/admin/leads` — pipeline, create lead, send intake (T7), consult
  scheduling (direct GCal push), offers.
- `/intake/{token}` — public one-page intake form → `/api/intake` →
  family/student upsert (email-deduped) + lead flip.
- `/admin/agreements` — per-family status, PDF snapshots, chase button,
  unaccepted-with-active-tutoring list, new-version publishing.
- `/agreements/{token}` — public policy page → `/api/agreements` →
  acceptance record + best-effort PDF snapshot.
- Emails: `T7_INTAKE_REQUEST`, `T8_WELCOME_HANDOFF` (registered in
  `templateMetaFor`), plus the standalone `agreement_request` chase email.
