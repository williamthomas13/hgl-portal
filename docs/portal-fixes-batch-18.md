# Portal fixes — batch 18 (READY FOR CODE — batches 16 & 17 shipped)

Two tiers: the greenlit UX items (PL-131…137) and the audit-hardening tier (PL-138…155, from the July 23 six-pass codebase audit — every finding was re-verified in source; file:line refs are pre-batch-16/17 and may have drifted slightly, the described code is findable). **Hard deadline: PL-144 (monthly generation) must land before Aug 20** — the first real generation run. Suggested order: PL-144 first, then money/email correctness (138–143, 145–148), then the rest.

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

## PL-137 (small) · Coverage alerts need per-template sample pins (test-sends show the registration sample)

**Found (Scarlett's draft review, Jul 24):** AL_COVERAGE_REQUEST and AL_COVERAGE_RESOLVED test-sends render the shared `alertDetailsBlock` fallback — the registration-flavored sample ("Ana García registered for SIS SAT Prep… Add-on purchased… 3 enrolled / 8 min / 15 cap") — because these two templates body as `{alertDetailsBlock}` but were never given per-template sample pins (`comms-variables.ts` ~line 990's PL-82 pin table has entries for the other AL keys, none for AL_COVERAGE_*). Real sends are correct (the coverage flow composes the block live). PL-96 class: review surface lying, production fine.

**Fix:** add per-template pins for both keys, built FROM the real coverage composer's output shape (drift-guarded per the PL-96 pattern, not hand-written HTML): request = session date/time, student + subject, requesting tutor, candidate, accept/decline deep links (test-link hrefs); resolved = the outcome line variants (accepted/declined/withdrawn — pin the accepted case, note the variants exercise in E2E). While there, audit the pin table for any OTHER `{alertDetailsBlock}` template lacking a pin (the two SUB_COVERAGE tutor emails use their own variables — check them too) and add missing ones the same way.

**Verify:** preview + test-send of both coverage alerts show coverage content, zero registration copy · pin-vs-composer drift guard in place · pin-table audit documented in the checkoff.

---

# Hardening tier (audit findings, PL-138…155)

## PL-144 · ⚠️ BEFORE AUG 20 · Monthly generation: catch-up + per-family isolation
`cron/reminders/route.ts` ~1658: `if (denverDay === generateDay)` — a fully-failed generation day (outage, deploy breakage) skips the month entirely; recovery is manual-only. And `generateMonthlyCycle` throws on any per-engagement insert error, so one poison row starves every family iterated after it, every retry, while earlier families already got T1s. **Fix:** gate on `denverDay >= generateDay` + an idempotent "generated for month X" marker (the code is already re-runnable); wrap per-engagement/per-family work in try/catch, collect failures into ONE admin alert ("generated 14/16 — 2 failed: …" with deep links), never abort the loop. **Verify:** E2E: skip the gen day → next sweep generates; seeded poison engagement → all other families complete + alert fired.

## PL-138 · SU dedupe keys on the transition, not the destination
`route.ts` ~683-718: room A→B→A→B suppresses the second "now B" email forever (key = destination state). Key on old→new (or include a change-seq). Verify with the A→B→A→B fixture: three emails.

## PL-139 · Waitlist offer integrity: stamp on 'duplicate' + claim checkout expires with the offer
(a) `waitlist-offers.ts` ~67-77: a crash between send and stamp deadlocks the offer (never expires, never rolls) while capacity stops counting it — stamp `waitlist_offer_expires_at` on the `'duplicate'` claim path too. (b) `api/waitlist/claim`: the Stripe session outlives the 48h window (~24h grace) while the spot re-offers — set Checkout `expires_at` to the offer deadline (min 30min per Stripe). Verify: crash-sim leaves a recoverable offer; expired-offer checkout link refuses payment.

## PL-140 · Instructor nudge double-send on window entry
`route.ts` ~981-1012: a class entering the ≤8-day window gets the initial nudge at 9:00 and re-nudge #2 at 10:00. Check the initial's sent-at before re-nudging (re-nudges space off the previous SEND, not window position). Verify: fixture entering the window gets exactly one email that day.

## PL-141 · One `effectiveDeadline()` for min-enrollment/FP/registration-close
Three defaults disagree (`route.ts` ~851 vs ~1363 vs `lifecycle.ts` ~375: first−7d vs first vs first) so the decision brief asserts dates the other calendars don't use. One shared helper, used by all three + the FP-status line. Verify: no-explicit-deadline fixture renders consistent dates everywhere.

## PL-142 · QBO receipts snapshot prices at payment time
`qbo-sync.ts` ~269-293 reads TODAY'S class price — a price change after payment posts wrong amounts (silently short, or a fake "promo discount") and breaks refund splits. Store/derive component prices from the Stripe line items at payment (PL-125's fan-out already knows per-student amounts). Also fix add-on `price_paid` snapshotting current package price at webhook time (`checkout-paid.ts` ~50-67) — same fix, take it from Stripe. Verify: raise the class price after a fixture payment → receipt posts the paid amount.

## PL-143 · Paid-but-never-synced reconciliation
`tutoring-stripe.ts` ~409-438 / `checkout-paid.ts` ~97-101: if the QBO enqueue fails after the paid-marker, nothing retries or alerts — receipt permanently missing. Hourly sweep: paid + PI + no `qbo_sync_log` row older than 2h → enqueue + count on the PL-136 health card. Verify: delete a fixture's sync row → sweep re-enqueues.

## PL-145 · Invoice re-issue: void must succeed (or block), and due dates don't reset
`invoice/route.ts` ~30-55: when void fails, two payable Stripe invoices coexist (family can pay the stale pre-fee one); re-issue also resets the clock so a 30-day-overdue invoice gets fresh runway. Fail the re-issue loudly when void fails; carry the original due date. Verify: void-failure sim blocks; re-issued invoice keeps its due date.

## PL-146 · 10-day past-due flip must not strand autopay retries
`tutoring-stripe.ts` ~504-579: the overdue status flip takes the invoice out of the retry query's status set mid-dunning. Align the sets (retry continues on overdue until attempts exhaust). Verify: fixture at 10d with 1 retry left still retries.

## PL-147 · Family↔tutor DST divergence (suggest + promise)
`availability.ts` ~147-171 validates family availability for the first week only; `schedule-approval.ts` ~121-131 renders one family-local time as permanent. Cross-DST pairs drift an hour mid-engagement (international families = the common case). Score candidates against family windows per-occurrence across the horizon (like busy blocks); approval email states the anchor zone ("4:00 PM Denver time — your local time may shift with daylight saving"). Verify: Phoenix-tutor/Vancouver-family fixture across Nov 1.

## PL-148 · Late-reschedule fee sweep: month boundary in org TZ
`tutoring-billing.ts` ~423 uses a UTC month boundary vs tutor-local everywhere else — fees in the last ~7h of a Denver month defer a month. Use `zonedToUtc(month.firstDay,'00:00',ORG_TZ)`. Verify: 7pm-Denver-month-end fixture bills in the right month.

## PL-149 · Signed tokens gain issued-at + per-type TTL
Tokens are currently valid forever (state-side expiry only, some types) — a forwarded email is indefinite access. Embed iat + TTL per link type (generous for family forms — 90d; shorter for admin-ish links); expired → friendly "this link has aged out — here's a fresh one / reply to us" page, never a bare error. Coordinate with PL-131's counselor tokens. NOTE: this invalidates nothing existing until shipped; pre-launch is the time. Verify: expired-token E2E per link type renders the friendly page.

## PL-150 · attach-payment: payer-email match or admin-gate
`attach-payment/route.ts` ~22,88: staff can attach any Stripe session to any recent unpaid enrollment; payer email is only a sort. Require payer-email match with an explicit admin-only override ("emails don't match — attach anyway?" logged). Verify: mismatched attach refused for manager; admin override logged.

## PL-151 · res.json() guards + try/finally on mutation buttons (repo-wide pattern)
Wizard `engagement-wizard.tsx` ~499, `invoices-panel.tsx` ~110, coverage/session-notes panels: a gateway 500 (HTML body) throws past busy-flag resets — bricked buttons, lost wizard state, "Error: undefined". One pattern everywhere: `res.json().catch(()=>({}))` + try/finally around busy flags. Verify: stubbed 500 leaves buttons usable with a readable error.

## PL-152 · Hidden-panel polling stops
`attendance-panel.tsx` ~136-140 + CSS-hidden panels (PL-101) never unmount: every class card polls every 20s from any tab, forever; "Past & cancelled" mounts every past card. Gate intervals on section visibility (and pause on document.hidden). Verify: network tab quiet when the section isn't active.

## PL-153 · Small-input hardening: wizard slot overlap · score bounds + delete confirm · dashboard error state · deep-link auto-switch
(a) `engagement-wizard.tsx` ~471-517: reject duplicate/overlapping weekly slots (double-booked AND double-billed today). (b) `ScoresEntry.tsx` ~236-241: per-exam min/max (SAT section 200–800, ACT 1–36), confirm on diagnostic delete. (c) `dashboard-panel.tsx` ~29-41: fetch failure shows an error + retry, not eternal "Checking every condition…" (it's the landing page). (d) `engagements-panel.tsx` ~40-42 / `invoices-panel.tsx` ~94: deep-link targets outside the default view auto-switch the filter (ended engagements / older invoices — exactly what chase emails link to). Verify each with its obvious fixture.

## PL-154 · The XCL- daily calendar audit (the one silently-dropped spec item)
Phase-7 spec §4, promised at 7a launch: a daily read-only job comparing portal-pushed Google event titles, flagging hand-edited `XCL-` events ("cancelled on the calendar but not in the portal") as a state-driven Needs Attention row + digest line. Tutors still live in Google during the transition — this is the habit-lapse net. Read-only; no auto-mutation. Verify: hand-XCL a fixture event → row appears; fix in portal → clears.

## PL-155 · Production-send hygiene: unresolved-variable alert · origin-guard cutover note · live-preview parity
(a) `email.ts` ~1766: a real send with unresolved `{tokens}` only logs — alert instead (state-driven row). (b) Cutover runbook note IN CODE COMMENTS near the origin guard: when the custom domain lands, add the old vercel.app host to the allowlist or every live-template send refuses. (c) Admin comms Preview renders code copy even when the registry template is live (`comms-render.ts`) — preview the live version (the drift the twin system exists to prevent). Verify: seeded unresolved-token send fires the alert; preview of a live-template shows the registry body.
