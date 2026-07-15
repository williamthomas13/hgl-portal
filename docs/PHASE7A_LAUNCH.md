# Phase 7a Launch Runbook — Tutoring Core Scheduling + Google Calendar Push

Companion to docs/PHASE7_SPEC.md (§3–§5). Code is complete; these are the
steps only you can do, in order. Nothing pushes to Google (and nothing
breaks) until they're done — the queue fails soft and the rest of /admin is
unaffected.

## 1. Apply the migration — BEFORE deploying the code

`supabase/migrations/20260713000001_phase7a_tutoring.sql` (idempotent, safe to
re-run). The new /admin/tutoring page queries the new tables, so deploy code
only after the migration (the old code tolerates the migration fine).

After applying: check Supabase **Security Advisor shows zero findings**
(standing post-migration rule). Expected posture:
- `gcal_connection` RLS on with **no** policies (service-role only — the
  encrypted key never reaches a browser)
- `gcal_sync_log` staff-read only
- `subjects` authenticated-read / staff-write; `tutor_notes` staff-only
- `tutoring_engagements` / `tutoring_sessions` / `tutoring_invoices` /
  `tutoring_invoice_lines` / `timecards` staff CRUD with billed-delete
  guards + tutor/parent scoped reads

Seeded: 16 subjects from the 8/14/25 pricing sheet (test prep $110/hr,
subject tutoring $75/hr — local standard rates; EB/international/discount
rates are per-engagement overrides). Edit rates in the admin UI or SQL as
the sheet changes.

## 2. Google Cloud: project + service account (console.cloud.google.com)

Sign in with your Workspace admin account.
1. Create a project (e.g. `hgl-portal-calendar`).
2. **APIs & Services → Library** → "Google Calendar API" → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** (e.g.
   `hgl-portal-cal`). Skip the optional role/access steps.
4. Open it → **Keys → Add key → Create new key → JSON** → download. This
   file gets pasted into the portal (step 4); treat it like a root
   credential until then, delete the download after.
5. **Details** tab → copy the numeric **Unique ID** (OAuth2 client id) for
   step 3.

## 3. Google Admin: domain-wide delegation (admin.google.com, super admin)

1. **Security → Access and data control → API controls → Domain-wide
   delegation → Manage domain-wide delegation → Add new**.
2. Client ID: the numeric Unique ID from step 2.5.
3. OAuth scopes (comma-separated, exact):
   `https://www.googleapis.com/auth/calendar.events, https://www.googleapis.com/auth/calendar.freebusy`
4. **Authorize.** Usually live in minutes; Google allows up to 24h.

No per-tutor setup: the portal impersonates each tutor's own Workspace
address, so events land on their primary calendar and freebusy reads their
self-managed availability blocks. **Caveat:** only works for
`@highergroundlearning.com` accounts — a tutor on a personal Gmail needs a
Workspace account first (confirm with Kelsie which addresses tutors use).

## 4. Connect in the portal

/admin/tutoring → **Google Calendar** panel (admin only) → paste the JSON
key → Connect. The panel live-tests delegation by impersonating you; if it
reports the delegation check failed, it's almost always step 3 still
propagating — the key is saved and pushes start once Google catches up.

## 5. Enter tutors + QA script (sandbox-style, low stakes)

1. **Tutors panel**: enable tutoring on one real instructor (yourself or a
   friendly tutor), set subjects + timezone (defaults America/Denver).
   Matching notes are staff-only — tutors can never read them.
2. **New engagement**: pick an existing student → subject → that tutor →
   one weekly slot a few days out → create. Expect: "N sessions scheduled"
   (through end of next month) and, within a minute, events titled
   `Tutoring: {student} — {subject}` on the tutor's Google Calendar, with
   parent/student invited (per-family opt-out is `families.gcal_invite_attendees`).
3. **Freebusy**: block time in the tutor's Google Calendar over one of the
   slots, reload the wizard/schedule — expect gray shading + a conflict
   warning (warning only, never a block).
4. **Session actions** (Schedule → click a session): reschedule ≥24h out
   (event MOVES), reschedule <24h (original stays, XCL-prefixed; new event
   for the replacement), forfeit/no-show (event stays, XCL-prefixed),
   delete an entry mistake (event disappears).
5. Check the Google Calendar panel queue counters return to 0 pending and
   any failure alert email points at the failed row.

## 6. Migration-period notes

- The OM keeps her workflow until 7b/7c: this phase only replaces *typing
  sessions into Google Calendar*. Billing/timecards still run manually off
  the calendar — which now mirrors the portal exactly.
- Deleting a Google event by hand does NOT cancel the session in the portal
  (one-way push, deliberately); the portal recreates it on the next push of
  that session. Cancel/reschedule in the portal. The daily read-only `XCL-`
  audit safety net from spec §4 lands with 7c's cron work.
- Per-family Google invites default ON; flip
  `families.gcal_invite_attendees` off for any family that shouldn't get
  native invites (admin UI toggle arrives with the 7d parent surface).
