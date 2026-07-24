# Portal fixes — batch 18 (seeded — do NOT start until batches 16 & 17 are shipped)

First item below is greenlit by Scarlett (Jul 24). The audit-hardening tier (from the July 23 codebase audit, Part 2 of the walkthrough doc) will be appended to this doc before the batch goes to Code — headline items for planning: monthly-generation catch-up + per-family isolation (MUST land before Aug 20), family↔tutor DST divergence, unguarded res.json() pattern, hidden-panel polling, SU transition-keyed dedupe, waitlist offer stamping + claim-checkout expiry, instructor-nudge double-send, shared effectiveDeadline(), QBO price snapshots + paid-never-synced reconciliation + re-issue void handling, wizard slot-overlap validation, score bounds, dashboard error state, deep-link view auto-switch, token expiry, attach-payment payer match, the XCL- calendar audit, and the package-runway alert.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

## PL-131 · Counselor no-login roster view, linked from the counselor emails

Counselors already have tokenized no-login room entry (`/classroom-request/{id}?t=…`, PHASE4_SPEC §4b) and a login portal (`counselor-view`: school-scoped registration numbers, attendance, scores). What's missing is the middle: a counselor reading a CD digest who wants to see the roster right now shouldn't need to find their login.

- **Build:** a tokenized, read-only class page for counselors — house token pattern (HMAC, scoped to class + counselor email like `classroomRequestUrlFor`), no login. Content: the school-appropriate slice `counselor-view` already renders for that class — registered students + paid/registration counts, class schedule/details, and (matching existing counselor visibility rules) attendance and scores once they exist. Reuse the `counselor-view` components; render server-side with the same school scoping the RLS policies encode (this page bypasses RLS via token, so the scoping must be enforced in the query — counselor's school only, this class only).
- **Link it from the counselor emails:** CD digest ("See the live roster") and the CR/FP set where a roster link is natural. Keep the existing portal-login mention for the full multi-class view.
- **Privacy note:** tokenized pages are effectively bearer links — include student names and statuses per existing counselor visibility, but nothing beyond what `counselor-view` already shows that school's counselor; apply the PL-118 timezone discipline to any dates; and give the token the same lifetime policy the batch-16 PL-113/S3 work lands on (if token expiry ships, counselor roster tokens should expire and re-mint per send).
- **Chase synergy:** where the class still lacks a room, this page shows the same "Tell us the room" form field inline (reuse the classroom-request form component) — one page, both jobs.

**Verify:** token renders the right class for the right school and nothing else (wrong-school token E2E-fails) · counts match admin · room form works inline and stops the chase · links present in CD (and where natural in CR/FP) · token respects whatever expiry policy PL-113/S3 established · RLS-equivalent scoping proven in the query tests.

## PL-132 (small) · Tutor-view polish trio (Scarlett greenlit, Jul 24)

- **Meet links become a labeled "Join" link/button** in the upcoming-sessions list (and anywhere else the raw `https://meet.google.com/…` URL renders to a tutor) — raw URLs read as clutter and wrap badly on phones.
- **Each session row links its student to that student's session-note history** — the same history a substitute receives (PL-111/112); the tutor's handoff file is also their own memory. One tap from the list, not a hunt.
- **Class sessions are labeled distinctly from 1-on-1** in the tutor's upcoming list — a small "Class" badge (e.g. "ISD SAT Prep — Class/Workshop") vs the 1-on-1 rows, matching the PL-103 work-type split (different prep, different pay type; the timecard already distinguishes them — the schedule list should too).

**Verify:** join label renders (no raw URL) · student tap opens their note history · class vs 1-on-1 visually distinct in the list and consistent with the timecard's work-type attribution.

## PL-133 (small) · Dashboard manual notes — the sticky-note layer (Scarlett greenlit, Jul 24)

A deliberately dumb "add a note" on the Needs Attention card for staff (admin + manager): free text + done button, nothing else. Phone interruptions become pinned rows instead of desk sticky notes.
- Manual rows render in Needs Attention alongside the derived rows, visually distinguishable (e.g. a small "note" tag) so nobody mistakes a sticky note for a system condition; show who added it and when; "done" clears it (keep a trail — cleared_at/by, no hard delete).
- These are the ONE exception to the state-driven rule (PL-100): human-pinned, human-cleared. Do not add priorities, assignees, due dates, or categories — the moment it grows fields it competes with real task tools and loses. Text + done. If a note references a record, the person can paste a portal link and it should render clickable; that's the whole feature.
- RLS: staff read/write all notes (it's a shared ops surface, not personal).

**Verify:** add → renders tagged with author/when · done clears (trail kept) · derived rows unaffected · pasted portal links clickable · manager and admin both can add/clear.

## PL-134 (small) · Recent Activity: same-day grouping + type filter (Scarlett: do now, not at-volume)

- **Group same-day, same-type, same-target rows:** "3 registrations for ISD SAT Prep" instead of three rows; expandable to the individual rows on click (each still linking its record). Grouping key = day (school/ops-local per the PL-118 discipline, not UTC) + activity type + class/school where applicable.
- **Type filter row** above the feed: All · Registrations · Payments · Availability · Notes · (whatever other types the feed emits — derive the chip list from the actual type enum so new types appear automatically, don't hardcode). Filter is client-side state, defaults to All, no persistence needed.
- Keep the feed read-only and unpaginated-feeling (load more on scroll or a "show more" — whatever's already there stays).

**Verify:** three same-day registrations for one class collapse to one expandable row · filter chips match the emitted type set and filter correctly · day boundary uses local (not UTC) bucketing (the audit's F/dashboard note) · single events render exactly as today.

## PL-135 (tiny) · Needs Attention rows carry age

Every derived Needs Attention row shows how long the condition has existed ("waiting 3 days" — from the condition's own start: availability shared_at, class created without instructor, invoice due date…), so triage self-ranks without sorting UI. Age derives from the underlying record's timestamp, not from when the dashboard first noticed (state-driven discipline applies to the clock too). Rows with a promised deadline (PL-127's countdown) keep that instead — deadline beats age where both exist. Manual notes (PL-133) show added-date, no aging styling. Oldest-first ordering within severity if the card orders at all; no new controls.

**Verify:** ages match the underlying records (E2E with backdated fixtures) · PL-127 rows show the countdown not the age · local-time day math.

## PL-136 (small) · Dashboard "system health" card — ship BEFORE launch

Three numbers, one glance: **Resend sends today vs quota** (count today's `email_sends` real sends + test sends vs the configured daily cap — config value, default 100, updated when the plan upgrades; amber at 80%, red at 100% with "sends are failing" honesty) · **QBO sync queue depth** (pending + failed counts from `qbo_sync_log`, failed deep-links to the QuickBooks section) · **last cron sweep** ("hourly sweep last ran {time}" — stamp a `app_settings` row at sweep start/end; red if > 2h ago, since a stalled sweep silently stops the entire email lifecycle). Read-only card on the dashboard, admin + manager visible. No graphs, no history — three live numbers with deep links where action exists. (The Jul 23 quota exhaustion is the motivating incident: sends failed silently until an external email arrived.)

**Verify:** quota count matches email_sends reality · queue numbers match the QBO panel · sweep stamp updates hourly and the stale state renders red · card renders on the dashboard landing for both staff roles.
