# Portal fixes — batch 18 (✅ ALL 26 SHIPPED — July 24)

Two tiers: the greenlit UX items (PL-131…137) and the audit-hardening tier (PL-138…155, from the July 23 six-pass codebase audit — every finding was re-verified in source; file:line refs are pre-batch-16/17 and may have drifted slightly, the described code is findable). **Hard deadline: PL-144 (monthly generation) must land before Aug 20** — the first real generation run. Suggested order: PL-144 first, then money/email correctness (138–143, 145–148), then the rest.

**Status (July 24):** all 26 items shipped and pushed. Migrations `20260815000001` (PL-142 price snapshots), `20260816000001` (PL-156 coverage note), `20260817000001` (PL-133 dashboard notes), `20260817000002` (PL-136 sweep stamp) are APPLIED. Six new gates: `regress:monthly-generation` (15) · `regress:token-expiry` (19) · `regress:mutation-buttons` · `regress:alert-pins` (13) · `regress:coverage-note` (18) · `regress:counselor-roster` (12). Full battery green, 0 failures.

**Two things need you, Scarlett:** (1) `SUB_COVERAGE_NOTE` v1 and `SUB_COVERAGE_RESULT` v2 are seeded as DRAFTS awaiting your approval (PL-156). (2) `{counselorRosterLink}` is registered and supplied to the CR/FP sends but not placed in their bodies — those are your live copy, so the link resolves the moment you add it where it reads naturally (PL-131).

**Still open from batch 16:** set `TOKEN_SIGNING_SECRET` in Vercel. **Before the domain cutover:** read the PL-155b runbook comment in `base-url.ts` — the two steps have a required order.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

## PL-131 · Counselor no-login roster view, linked from the counselor emails

Counselors already have tokenized no-login room entry (`/classroom-request/{id}?t=…`, PHASE4_SPEC §4b) and a login portal (`counselor-view`: school-scoped registration numbers, attendance, scores). What's missing is the middle: a counselor reading a CD digest who wants to see the roster right now shouldn't need to find their login.

- **Build:** a tokenized, read-only class page for counselors — house token pattern (HMAC, scoped to class + counselor email like `classroomRequestUrlFor`), no login. Content: the school-appropriate slice `counselor-view` already renders for that class — registered students + paid/registration counts, class schedule/details, and (matching existing counselor visibility rules) attendance and scores once they exist. Reuse the `counselor-view` components; render server-side with the same school scoping the RLS policies encode (this page bypasses RLS via token, so the scoping must be enforced in the query — counselor's school only, this class only).
- **Link it from the counselor emails:** CD digest ("See the live roster") and the CR/FP set where a roster link is natural. Keep the existing portal-login mention for the full multi-class view.
- **Privacy note:** tokenized pages are effectively bearer links — include student names and statuses per existing counselor visibility, but nothing beyond what `counselor-view` already shows that school's counselor; apply the PL-118 timezone discipline to any dates; and give the token the same lifetime policy the batch-16 PL-113/S3 work lands on (if token expiry ships, counselor roster tokens should expire and re-mint per send).
- **Chase synergy:** where the class still lacks a room, this page shows the same "Tell us the room" form field inline (reuse the classroom-request form component) — one page, both jobs.

**Verify:** token renders the right class for the right school and nothing else (wrong-school token E2E-fails) · counts match admin · room form works inline and stops the chase · links present in CD (and where natural in CR/FP) · token respects whatever expiry policy PL-113/S3 established · RLS-equivalent scoping proven in the query tests.

**✅ SHIPPED (Jul 24).** `/class-roster/{id}?t=…&ce=…` — house HMAC token scoped to class AND counselor email. The roster card was EXTRACTED from `counselor-view` into `counselor-class-card.tsx` and both surfaces now render the identical component, so the logged-in and no-login views can never drift. **Scoping proven, not asserted:** the page runs as admin (no session → no RLS), so the school filter is enforced in its own query — `.eq('id', classId).in('school_id', <this counselor's ACTIVE affiliations>)`. `regress:counselor-roster` (12 checks) covers the wrong-school E2E in both directions, cross-class token reuse, cross-counselor reuse, unknown emails, and — because the affiliation check is live rather than baked into the link — a counselor who LEAVES the school losing access while their token is still cryptographically valid. Chase synergy shipped: where the class has no room, the same classroom-request form renders inline on this page (one page, both jobs). Token expiry follows PL-149's `family-form` lifetime (90d) with the friendly aged-out page. CD digest carries "See the live roster" per class (it rides `{digestClassListBlock}`, so the LIVE template picked it up with no body edit). **Doc note:** CR/FP are live templates carrying Scarlett's copy, so rather than silently rewriting them, `{counselorRosterLink}` is registered and supplied at send time — it resolves the moment she places it in a CR/FP body.

## PL-132 (small) · Tutor-view polish trio (Scarlett greenlit, Jul 24)

- **Meet links become a labeled "Join" link/button** in the upcoming-sessions list (and anywhere else the raw `https://meet.google.com/…` URL renders to a tutor) — raw URLs read as clutter and wrap badly on phones.
- **Each session row links its student to that student's session-note history** — the same history a substitute receives (PL-111/112); the tutor's handoff file is also their own memory. One tap from the list, not a hunt.
- **Class sessions are labeled distinctly from 1-on-1** in the tutor's upcoming list — a small "Class" badge (e.g. "ISD SAT Prep — Class/Workshop") vs the 1-on-1 rows, matching the PL-103 work-type split (different prep, different pay type; the timecard already distinguishes them — the schedule list should too).

**Verify:** join label renders (no raw URL) · student tap opens their note history · class vs 1-on-1 visually distinct in the list and consistent with the timecard's work-type attribution.

**✅ SHIPPED (Jul 24).** New `upcoming-sessions.tsx`: meeting URLs render as a labeled **Join** button (no raw URL), each 1-on-1 row's student opens their session-note history inline (new `student_notes` portal action, scoped so only a tutor who teaches or is covering that student can read it), and class/workshop sessions now appear in the schedule at all — they were missing entirely — carrying a **Class** badge matching the timecard's PL-103 work-type split. Class rows build their instants on the tutor's own clock via `zonedToUtc`, so they read like every other row.

## PL-133 (small) · Dashboard manual notes — the sticky-note layer (Scarlett greenlit, Jul 24)

A deliberately dumb "add a note" on the Needs Attention card for staff (admin + manager): free text + done button, nothing else. Phone interruptions become pinned rows instead of desk sticky notes.
- Manual rows render in Needs Attention alongside the derived rows, visually distinguishable (e.g. a small "note" tag) so nobody mistakes a sticky note for a system condition; show who added it and when; "done" clears it (keep a trail — cleared_at/by, no hard delete).
- These are the ONE exception to the state-driven rule (PL-100): human-pinned, human-cleared. Do not add priorities, assignees, due dates, or categories — the moment it grows fields it competes with real task tools and loses. Text + done. If a note references a record, the person can paste a portal link and it should render clickable; that's the whole feature.
- RLS: staff read/write all notes (it's a shared ops surface, not personal).

**Verify:** add → renders tagged with author/when · done clears (trail kept) · derived rows unaffected · pasted portal links clickable · manager and admin both can add/clear.

**✅ SHIPPED (Jul 24).** Migration `20260817000001` (applied) + `/api/admin/dashboard-notes`. Text + done, nothing more — no priorities, assignees, due dates, or categories. Notes render tagged 📌 **Note** with author and added-date, done clears them keeping the trail (`cleared_at`/`cleared_by`, never a hard delete), and pasted portal links render clickable. Staff-wide RLS (a shared ops surface). **Verified in the running app:** added a note → rendered tagged with its link clickable → done cleared it → the row disappeared and the DB kept `cleared_at`/`cleared_by`.

## PL-134 (small) · Recent Activity: same-day grouping + type filter (Scarlett: do now, not at-volume)

- **Group same-day, same-type, same-target rows:** "3 registrations for ISD SAT Prep" instead of three rows; expandable to the individual rows on click (each still linking its record). Grouping key = day (school/ops-local per the PL-118 discipline, not UTC) + activity type + class/school where applicable.
- **Type filter row** above the feed: All · Registrations · Payments · Availability · Notes · (whatever other types the feed emits — derive the chip list from the actual type enum so new types appear automatically, don't hardcode). Filter is client-side state, defaults to All, no persistence needed.
- Keep the feed read-only and unpaginated-feeling (load more on scroll or a "show more" — whatever's already there stays).

**Verify:** three same-day registrations for one class collapse to one expandable row · filter chips match the emitted type set and filter correctly · day boundary uses local (not UTC) bucketing (the audit's F/dashboard note) · single events render exactly as today.

**✅ SHIPPED (Jul 24).** Grouping key = local day + activity type + class (never UTC — the audit's dashboard note), collapsing to "2 availability ▸" expandable to the individual rows, each still deep-linking its record. Filter chips are DERIVED from the types the feed actually emits, so a new type appears on its own rather than needing the chip list edited. Client-side, defaults to All, no persistence. Feed limits were widened (registrations 8→25) so a day's worth actually has something to collapse. **Verified live:** the group expanded to both rows, and the Payments chip filtered to exactly the two payment rows.

## PL-135 (tiny) · Needs Attention rows carry age

Every derived Needs Attention row shows how long the condition has existed ("waiting 3 days" — from the condition's own start: availability shared_at, class created without instructor, invoice due date…), so triage self-ranks without sorting UI. Age derives from the underlying record's timestamp, not from when the dashboard first noticed (state-driven discipline applies to the clock too). Rows with a promised deadline (PL-127's countdown) keep that instead — deadline beats age where both exist. Manual notes (PL-133) show added-date, no aging styling. Oldest-first ordering within severity if the card orders at all; no new controls.

**Verify:** ages match the underlying records (E2E with backdated fixtures) · PL-127 rows show the countdown not the age · local-time day math.

**✅ SHIPPED (Jul 24).** Every derived row carries `since` from the underlying record's own timestamp — class `created_at`, invoice `due_at`, coverage-request `created_at`, timecard `tutor_confirmed_at`, lead `updated_at` — never from when the dashboard first noticed (the state-driven discipline applies to the clock too). Rows with a promised date (PL-127 availability, min-enrollment deadline) show that countdown INSTEAD; a promise beats an age. Manual notes show their added-date with no aging styling. Oldest-first within severity; no new controls. Local day math throughout. **Verified live:** the intake row read "waiting 7 days" against a record shared Jul 17.

## PL-136 (small) · Dashboard "system health" card — ship BEFORE launch

Three numbers, one glance: **Resend sends today vs quota** (count today's `email_sends` real sends + test sends vs the configured daily cap — config value, default 100, updated when the plan upgrades; amber at 80%, red at 100% with "sends are failing" honesty) · **QBO sync queue depth** (pending + failed counts from `qbo_sync_log`, failed deep-links to the QuickBooks section) · **last cron sweep** ("hourly sweep last ran {time}" — stamp a `app_settings` row at sweep start/end; red if > 2h ago, since a stalled sweep silently stops the entire email lifecycle). Read-only card on the dashboard, admin + manager visible. No graphs, no history — three live numbers with deep links where action exists. (The Jul 23 quota exhaustion is the motivating incident: sends failed silently until an external email arrived.)

**Verify:** quota count matches email_sends reality · queue numbers match the QBO panel · sweep stamp updates hourly and the stale state renders red · card renders on the dashboard landing for both staff roles.

**✅ SHIPPED (Jul 24).** Migration `20260817000002` (applied) seeds `resend_daily_cap` = 100 as configuration (it changes when the plan upgrades — an edit, not a deploy). Three numbers: sends today vs cap (amber at 80%, red at 100% with "sends are failing"), QuickBooks pending + failed with the failed count deep-linking, and when the hourly sweep last FINISHED (red past 2h). The cron now stamps both `cron_sweep_started_at` and `cron_sweep_finished_at`, which adds a state the doc didn't ask for but the incident implies: a run that STARTED and never finished renders as "a run started and hasn't finished" — a hanging sweep is invisible to a finish-stamp alone. **Verified live:** card reads 5/100 · 0 waiting · "never recorded / overdue" (correct — the cron has never run against this local DB).

## PL-137 (small) · Coverage alerts need per-template sample pins (test-sends show the registration sample)

**Found (Scarlett's draft review, Jul 24):** AL_COVERAGE_REQUEST and AL_COVERAGE_RESOLVED test-sends render the shared `alertDetailsBlock` fallback — the registration-flavored sample ("Ana García registered for SIS SAT Prep… Add-on purchased… 3 enrolled / 8 min / 15 cap") — because these two templates body as `{alertDetailsBlock}` but were never given per-template sample pins (`comms-variables.ts` ~line 990's PL-82 pin table has entries for the other AL keys, none for AL_COVERAGE_*). Real sends are correct (the coverage flow composes the block live). PL-96 class: review surface lying, production fine.

**Fix:** add per-template pins for both keys, built FROM the real coverage composer's output shape (drift-guarded per the PL-96 pattern, not hand-written HTML): request = session date/time, student + subject, requesting tutor, candidate, accept/decline deep links (test-link hrefs); resolved = the outcome line variants (accepted/declined/withdrawn — pin the accepted case, note the variants exercise in E2E). While there, audit the pin table for any OTHER `{alertDetailsBlock}` template lacking a pin (the two SUB_COVERAGE tutor emails use their own variables — check them too) and add missing ones the same way.

**Verify:** preview + test-send of both coverage alerts show coverage content, zero registration copy · pin-vs-composer drift guard in place · pin-table audit documented in the checkoff.

---

# Hardening tier (audit findings, PL-138…155)

**✅ SHIPPED (Jul 24).** Both pins are COMPUTED from the real composer, not hand-written — which required extracting the alert copy into `coverage-copy.ts` as a genuine leaf, because `comms-variables.ts` is reachable from the client bundle and `coverage.ts` pulls in `supabase-admin` (the exact crash PL-96 hit with `cancellation-copy.ts`). `AL_COVERAGE_RESOLVED` pins the accepted case; all four variants are exercised in the gate. **Pin-table audit, as asked:** 17 registry templates body as `{alertDetailsBlock}`; all 17 are now pinned. The two SUB_COVERAGE tutor emails use their own variables and correctly need no pin. New gate `regress:alert-pins` (13 checks) enforces "every `{alertDetailsBlock}` template has a pin" so this class of bug cannot recur, and drift-checks both coverage pins against the composer's live output.

## PL-144 · ⚠️ BEFORE AUG 20 · Monthly generation: catch-up + per-family isolation
`cron/reminders/route.ts` ~1658: `if (denverDay === generateDay)` — a fully-failed generation day (outage, deploy breakage) skips the month entirely; recovery is manual-only. And `generateMonthlyCycle` throws on any per-engagement insert error, so one poison row starves every family iterated after it, every retry, while earlier families already got T1s. **Fix:** gate on `denverDay >= generateDay` + an idempotent "generated for month X" marker (the code is already re-runnable); wrap per-engagement/per-family work in try/catch, collect failures into ONE admin alert ("generated 14/16 — 2 failed: …" with deep links), never abort the loop. **Verify:** E2E: skip the gen day → next sweep generates; seeded poison engagement → all other families complete + alert fired.

**✅ SHIPPED (Jul 24) — the Aug 20 blocker is cleared.** New `generationDueFor()`: due when `denverDay >= generateDay` AND no completion marker for the target month, so a fully-failed generation day is caught up by the next hourly sweep instead of skipping the month. Per-engagement and per-family work is wrapped in try/catch; failures collect into ONE admin alert (each family deep-linked) and the loop never aborts. A family whose session materialization failed is skipped entirely rather than being handed a partial invoice + T1. The marker is stamped only by a zero-failure run, so partial failures self-heal on the next sweep. New gate `regress:monthly-generation` (15 checks): the catch-up gate in both directions, a poison engagement isolating to exactly one family while everyone else completes with invoices and T1s, and a clean re-run after the fix picking up only the failed family without duplicating the healthy one.

## PL-138 · SU dedupe keys on the transition, not the destination
`route.ts` ~683-718: room A→B→A→B suppresses the second "now B" email forever (key = destination state). Key on old→new (or include a change-seq). Verify with the A→B→A→B fixture: three emails.

**✅ SHIPPED.** Key is now the TRANSITION (old→new state hash) plus a per-enrollment change sequence carried in the snapshot payload — a transition hash alone still collapses A→B→A→B to two emails, since the third repeats the first. The A→B→A→B fixture now sends three.

## PL-139 · Waitlist offer integrity: stamp on 'duplicate' + claim checkout expires with the offer
(a) `waitlist-offers.ts` ~67-77: a crash between send and stamp deadlocks the offer (never expires, never rolls) while capacity stops counting it — stamp `waitlist_offer_expires_at` on the `'duplicate'` claim path too. (b) `api/waitlist/claim`: the Stripe session outlives the 48h window (~24h grace) while the spot re-offers — set Checkout `expires_at` to the offer deadline (min 30min per Stripe). Verify: crash-sim leaves a recoverable offer; expired-offer checkout link refuses payment.

**✅ SHIPPED.** (a) The `'duplicate'` claim path stamps the deadline too, guarded by `.is('waitlist_offer_expires_at', null)` so a live deadline is never extended. (b) Checkout `expires_at` is set to the offer deadline, clamped into Stripe's 30-minute–24-hour window.

## PL-140 · Instructor nudge double-send on window entry
`route.ts` ~981-1012: a class entering the ≤8-day window gets the initial nudge at 9:00 and re-nudge #2 at 10:00. Check the initial's sent-at before re-nudging (re-nudges space off the previous SEND, not window position). Verify: fixture entering the window gets exactly one email that day.

**✅ SHIPPED.** Re-nudges now space off the previous SEND (3 days, matching the −11d/−8d window spacing) by reading the last `instructor_nudge:*` send row, instead of off window position. The initial's own-sweep return only ever suppressed the same hour.

## PL-141 · One `effectiveDeadline()` for min-enrollment/FP/registration-close
Three defaults disagree (`route.ts` ~851 vs ~1363 vs `lifecycle.ts` ~375: first−7d vs first vs first) so the decision brief asserts dates the other calendars don't use. One shared helper, used by all three + the FP-status line. Verify: no-explicit-deadline fixture renders consistent dates everywhere.

**✅ SHIPPED.** `effectiveDeadline(bundle)` in `lifecycle.ts` = explicit enrollment deadline, else registration close, else first session — matching the chain `collateral.ts` already used. Both cron call sites route through it (the brief's arbitrary first−7d default is gone), and the class wizard's misleading "default (7 days before start)" hint was corrected.

## PL-142 · QBO receipts snapshot prices at payment time
`qbo-sync.ts` ~269-293 reads TODAY'S class price — a price change after payment posts wrong amounts (silently short, or a fake "promo discount") and breaks refund splits. Store/derive component prices from the Stripe line items at payment (PL-125's fan-out already knows per-student amounts). Also fix add-on `price_paid` snapshotting current package price at webhook time (`checkout-paid.ts` ~50-67) — same fix, take it from Stripe. Verify: raise the class price after a fixture payment → receipt posts the paid amount.

**✅ SHIPPED.** Migration `20260815000001` (applied, with a backfill for existing paid rows). Component prices are snapshotted at CART BUILD (`class_price_snapshot`/`pending_addon_price`) and promoted at payment (`class_price_paid`/`addon_price_paid`); `qbo-sync` reads the paid columns and falls back to the live price only for pre-migration rows. `recordAddon` takes the cart-build price rather than re-reading `tutoring_packages` at webhook time; add-on-only checkouts use their own charged total.

## PL-143 · Paid-but-never-synced reconciliation
`tutoring-stripe.ts` ~409-438 / `checkout-paid.ts` ~97-101: if the QBO enqueue fails after the paid-marker, nothing retries or alerts — receipt permanently missing. Hourly sweep: paid + PI + no `qbo_sync_log` row older than 2h → enqueue + count on the PL-136 health card. Verify: delete a fixture's sync row → sweep re-enqueues.

**✅ SHIPPED.** `sweepUnsyncedPayments()` runs hourly over both class enrollments and tutoring invoices: paid + PI + no `qbo_sync_log` row + older than 2h → enqueue. Counted as `qbo_reconciled` and surfaced through the PL-136 health card's queue numbers.

## PL-145 · Invoice re-issue: void must succeed (or block), and due dates don't reset
`invoice/route.ts` ~30-55: when void fails, two payable Stripe invoices coexist (family can pay the stale pre-fee one); re-issue also resets the clock so a 30-day-overdue invoice gets fresh runway. Fail the re-issue loudly when void fails; carry the original due date. Verify: void-failure sim blocks; re-issued invoice keeps its due date.

**✅ SHIPPED.** The void is now checked and must succeed (an already-paid Stripe invoice refuses outright); a failure aborts the re-issue and returns a 502 explaining that the edit was saved but nothing was re-issued, so two payable invoices can never coexist. The original `due_at` carries through re-issues; because Stripe rejects past due dates, only ITS field is floored to +3 days while the portal clock — which drives the 10/30-day escalation and every date quoted to the family — keeps the real one.

## PL-146 · 10-day past-due flip must not strand autopay retries
`tutoring-stripe.ts` ~504-579: the overdue status flip takes the invoice out of the retry query's status set mid-dunning. Align the sets (retry continues on overdue until attempts exhaust). Verify: fixture at 10d with 1 retry left still retries.

**✅ SHIPPED.** `past_due` is in the retry query's status set, and `chargeAutopay`'s optimistic claim accepts it while PRESERVING it (a retry no longer regresses an escalated invoice back to `invoiced`, which would re-arm the 30-day decision from the wrong place). The attempt counter, not the status, ends dunning.

## PL-147 · Family↔tutor DST divergence (suggest + promise)
`availability.ts` ~147-171 validates family availability for the first week only; `schedule-approval.ts` ~121-131 renders one family-local time as permanent. Cross-DST pairs drift an hour mid-engagement (international families = the common case). Score candidates against family windows per-occurrence across the horizon (like busy blocks); approval email states the anchor zone ("4:00 PM Denver time — your local time may shift with daylight saving"). Verify: Phoenix-tutor/Vancouver-family fixture across Nov 1.

**✅ SHIPPED.** Candidate slots are now scored against the family's own window per-occurrence across the whole horizon (like busy blocks), and any slot that leaves that window at any point ranks below every slot that never does — a DST-stable choice beats a marginally emptier calendar. The approval email gains `{scheduleZoneNote}`, which names the anchor zone ONLY when the two zones can actually drift (compared now vs six months out), so it never appears where it would be noise. Wired into T_SCHEDULE_CONFIRM, its nudge, and T_SCHEDULE_SET, in both the registry and code-twin paths.

## PL-148 · Late-reschedule fee sweep: month boundary in org TZ
`tutoring-billing.ts` ~423 uses a UTC month boundary vs tutor-local everywhere else — fees in the last ~7h of a Denver month defer a month. Use `zonedToUtc(month.firstDay,'00:00',ORG_TZ)`. Verify: 7pm-Denver-month-end fixture bills in the right month.

**✅ SHIPPED.** `zonedToUtc(month.firstDay, '00:00', ORG_TZ)` replaces the UTC boundary, matching the tutor-local bounds the rest of the engine uses.

## PL-149 · Signed tokens gain issued-at + per-type TTL
Tokens are currently valid forever (state-side expiry only, some types) — a forwarded email is indefinite access. Embed iat + TTL per link type (generous for family forms — 90d; shorter for admin-ish links); expired → friendly "this link has aged out — here's a fresh one / reply to us" page, never a bare error. Coordinate with PL-131's counselor tokens. NOTE: this invalidates nothing existing until shipped; pre-launch is the time. Verify: expired-token E2E per link type renders the friendly page.

**✅ SHIPPED.** `mintToken`/`checkToken` in `signing.ts`: tokens carry the issued day inside the signed material (so it can't be edited to extend a link) with per-type lifetimes — family forms 90d, family actions 120d, tutor actions 45d (coverage is arranged weeks ahead), staff 14d, and calendar feeds never (a subscribed calendar that silently dies is worse than a live one). Expired is distinguishable from forged, so pages render the friendly aged-out copy. **Backward compatible on purpose:** tokens minted before this verify exactly as before and never expire — nothing already in a family's inbox breaks. New gate `regress:token-expiry` (19 checks) including the legacy-compatibility promise.

## PL-150 · attach-payment: payer-email match or admin-gate
`attach-payment/route.ts` ~22,88: staff can attach any Stripe session to any recent unpaid enrollment; payer email is only a sort. Require payer-email match with an explicit admin-only override ("emails don't match — attach anyway?" logged). Verify: mismatched attach refused for manager; admin override logged.

**✅ SHIPPED.** A payer-email mismatch refuses with a 409 naming both addresses; only an admin may override (a manager is refused outright), and the override is logged AND alerted to the Ops Director — a console line dies with the lambda, and this is a money decision. The match-payment UI asks before overriding and explains when it's legitimate (a grandparent paying, a second address).

## PL-151 · res.json() guards + try/finally on mutation buttons (repo-wide pattern)
Wizard `engagement-wizard.tsx` ~499, `invoices-panel.tsx` ~110, coverage/session-notes panels: a gateway 500 (HTML body) throws past busy-flag resets — bricked buttons, lost wizard state, "Error: undefined". One pattern everywhere: `res.json().catch(()=>({}))` + try/finally around busy flags. Verify: stubbed 500 leaves buttons usable with a readable error.

**✅ SHIPPED.** All 35 unguarded `await res.json()` sites across client components are `.catch()`-guarded, plus two `.then(r => r.json())` chains with their consumers null-guarded. The four audited panels (wizard, invoices, coverage, session-notes) reset their busy flags in a `finally` with readable errors — never "Error: undefined", and the wizard's state survives a failure. New gate `regress:mutation-buttons` enforces rule 1 repo-wide and rule 2 on the audited panels; the remaining 41 busy-flag sites are reported (not failed) since the acute crash source is gone and only a network-level throw can reach them.

## PL-152 · Hidden-panel polling stops
`attendance-panel.tsx` ~136-140 + CSS-hidden panels (PL-101) never unmount: every class card polls every 20s from any tab, forever; "Past & cancelled" mounts every past card. Gate intervals on section visibility (and pause on document.hidden). Verify: network tab quiet when the section isn't active.

**✅ SHIPPED.** New `useVisibleInterval` hook: work is skipped when the panel has a `display:none` ancestor (offsetParent null) or the browser tab is backgrounded, with one immediate catch-up on return so nothing is stale when someone comes back. Applied to the attendance panel (every class card, including every "Past & cancelled" one) and the dashboard.

## PL-153 · Small-input hardening: wizard slot overlap · score bounds + delete confirm · dashboard error state · deep-link auto-switch
(a) `engagement-wizard.tsx` ~471-517: reject duplicate/overlapping weekly slots (double-booked AND double-billed today). (b) `ScoresEntry.tsx` ~236-241: per-exam min/max (SAT section 200–800, ACT 1–36), confirm on diagnostic delete. (c) `dashboard-panel.tsx` ~29-41: fetch failure shows an error + retry, not eternal "Checking every condition…" (it's the landing page). (d) `engagements-panel.tsx` ~40-42 / `invoices-panel.tsx` ~94: deep-link targets outside the default view auto-switch the filter (ended engagements / older invoices — exactly what chase emails link to). Verify each with its obvious fixture.

**✅ SHIPPED, all four.** (a) `overlappingSlots()` refuses colliding weekly slots in the wizard (naming which ones clash) AND in the route on both create and update — the route is the authority. (b) Per-exam bounds (SAT 200–800, PSAT 160–760, ACT 1–36) marked live on the inputs, blocking save, plus a confirm on score delete naming the test and student. (c) The dashboard shows an error with a Try again button instead of pulsing "Checking every condition…" forever — on the landing page that reads as "nothing needs attention", the one thing it must never imply. (d) A `?family=` deep-link whose schedules have all ENDED auto-switches to the past view, and a deep-linked invoice outside the 120-row window is fetched explicitly — exactly the invoices chase emails link to.

## PL-154 · The XCL- daily calendar audit (the one silently-dropped spec item)
Phase-7 spec §4, promised at 7a launch: a daily read-only job comparing portal-pushed Google event titles, flagging hand-edited `XCL-` events ("cancelled on the calendar but not in the portal") as a state-driven Needs Attention row + digest line. Tutors still live in Google during the transition — this is the habit-lapse net. Read-only; no auto-mutation. Verify: hand-XCL a fixture event → row appears; fix in portal → clears.

**✅ SHIPPED.** `auditXclDrift()` compares portal-confirmed sessions against their Google events across the near horizon (14 days back, 30 forward) and flags any whose event was hand-marked `XCL-`, hand-deleted, or Google-cancelled — they still bill and count on the timecard as they stand. Read-only: it never mutates a calendar or a session, because auto-cancelling a paid session from a title string is exactly the kind of silent action this codebase avoids. Surfaces as a state-driven Needs Attention row (clears when fixed in the portal) and a weekly digest section. A calendar read failure yields nothing rather than crying wolf.

## PL-155 · Production-send hygiene: unresolved-variable alert · origin-guard cutover note · live-preview parity
(a) `email.ts` ~1766: a real send with unresolved `{tokens}` only logs — alert instead (state-driven row). (b) Cutover runbook note IN CODE COMMENTS near the origin guard: when the custom domain lands, add the old vercel.app host to the allowlist or every live-template send refuses. (c) Admin comms Preview renders code copy even when the registry template is live (`comms-render.ts`) — preview the live version (the drift the twin system exists to prevent). Verify: seeded unresolved-token send fires the alert; preview of a live-template shows the registry body.

**✅ SHIPPED, all three.** (a) A real send carrying `{placeholders}` now fires an admin alert (per template per day) and records the unfilled names on the send row, from which the dashboard derives a live row per broken TEMPLATE — a broken template keeps breaking every send until someone fixes it, so it's a condition, not a past event. (b) The cutover runbook lives in code comments beside the origin guard, with `ADDITIONAL_PRODUCTION_HOSTS` as the actual mechanism and the required ORDER of the two steps — without it, every live-template send refuses the day the custom domain lands. (c) Admin Preview now renders through `renderEmail`, serving the LIVE registry body when there is one and falling back to the same code twin when there isn't — precisely what the pipeline does at send time.

## PL-156 (small) · SUB_COVERAGE_RESULT gains a "send the sub a note" button (Scarlett, Jul 24)

When a coverage request is accepted, the requesting tutor's outcome email should let them respond in one tap — say thanks and/or hand over context. Add a button to SUB_COVERAGE_RESULT (accepted variant): **"Send {subFirstName} a note"** → tokenized link (house pattern, requesting-tutor-scoped) to a tiny form: one text box, one send. The note (a) is emailed to the substitute and (b) is appended to the coverage handoff bundle the sub already receives (PL-112 machinery), so context said once lives with the handoff. Declined/withdrawn variants keep no button (nothing to hand off). Never act-from-email — the button opens the form, the form sends. Update the template body + the PL-137 sample pin accordingly; re-test-send for Scarlett; the SUB_COVERAGE_RESULT template stays DRAFT until she approves the new version.

**Verify:** accepted-variant test-send shows the button (token, test-link in samples) · note → sub's email + handoff bundle E2E · declined variant has no button.

**✅ SHIPPED — both templates left DRAFT for your approval.** Migration `20260816000001` (applied). The accepted variant gains **Send {subFirstName} a note** → `/coverage/note/{token}`, a one-box form; declined and withdrawn variants get no button, enforced in the composer and asserted in the gate. Never acts from the email: the button opens the form, and only a JS-executed POST sends. The note emails the substitute AND is stored on the coverage request, so it rides the handoff bundle — it renders above the session-note history in their portal. New `SUB_COVERAGE_NOTE` template (v1, draft) and `SUB_COVERAGE_RESULT` v2 (draft) both seeded with `live=false`; the seeding script asserts this rather than trusting it. The PL-137 sample pin was updated to match — `{coverageNoteButton}` has its own sample so the accepted variant previews WITH the button. New gate `regress:coverage-note` (18 checks) covering the variant rules, the note round-trip into the handoff, request-scoped tokens, and the refusals.
