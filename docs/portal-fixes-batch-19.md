# Portal fixes — batch 19 (READY FOR CODE — handed off July 27)

Post-batch-18 items: prod-verification findings (Jul 24-27) + Scarlett's full UI review (billing, students, new-schedule form, pipeline, instructors, contact settings) + the calendar/holds/suggester feature trio. **COMPLETE — 21 items, PL-157…177. Ready to build.** If this doc changes after you've pulled it, Scarlett will send an explicit re-read ask.

Next PL after this batch: **PL-178**.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

## PL-157 (tiny) · SUB_COVERAGE_NOTE's sample is internally incoherent

**✅ SHIPPED (Jul 27).** The diagnosis was exactly right: `{tutorFirstName}` resolved from the shared pool ("Billy") while `{coverageNoteBlock}` carried a pin written around Jordan. The fix is structural, per the PL-80c lesson: all SUB_* tutor copy moved into the leaf `coverage-copy.ts` (`coverageSessionLines` / `coverageOutcomeLine` / `coverageNoteButtonHtml` / `coverageNoteHtml`), `coverage.ts` real sends now compose through those, and ONE exported `SAMPLE_COVERAGE_FACTS` scenario (Billy Thomas asked, Jordan Lee accepted and covers Ana's session, Billy sends the note) derives the AL_* pins AND new per-template pins for all three SUB_* templates — each pin covering every scenario-bearing variable its template renders, greeting included. The shared-pool values point at the same derived constants, so shared and pinned literally cannot disagree. `regress:alert-pins` grew from 13 to 24 checks: any template using a handoff variable must pin its greeting, the two people must be distinct, the prose must address the person greeted, and every pinned block must equal the composer's live output. Preview verified: NOTE greets Jordan / from Billy Thomas / prose thanks Jordan; RESULT still coherent (greets Billy, "Jordan Lee accepted", "Send Jordan a note"); OFFER now greets Jordan too; zero unresolved variables. Bonus real-send bug found during extraction: the inline note wrapper escaped `<` AFTER inserting `<br>` tags, so a single line-break in a real hand-over note rendered as visible "`<br>`" text — fixed in the composer. Sibling sweep: the AL_* pin family all stars Ana García, matching the shared `{alertStudentName}`; no other shared-vs-pinned collision found. Templates were NOT re-seeded (the bodies were always fine). **Test-send queued for after this deploys** so the review surface Scarlett flips on renders the fixed sample.

The `SUB_COVERAGE_NOTE` v1 preview — the surface Scarlett reviews the draft on — renders as one person writing to themselves. The greeting resolves "Hi Billy," the line below reads "Billy Thomas sent this along about the session you're covering," and then the pinned note block's prose thanks a *different* person: "Thanks so much for taking this one, Jordan — I owe you." Sender and recipient are the same name, and the body text names a third state of the world.

The template is fine; only the sample is wrong. But this is the **PL-80b** failure exactly (IN_DIGEST's min-met milestone line paired with contradicting 6/8 counts) — a sample that no real send could ever produce, failing the PL-56 "samples read truthfully" standard and making review pause.

**The likely cause is PL-80c-shaped, and that's the part worth getting right.** `{tutorFirstName}` appears to be resolving from the shared sample pool ("Billy") while `{coverageNoteBlock}` carries its own PL-137 per-template pin whose prose was written around a different scenario (Jordan covering for Billy). If that diagnosis is right, re-sampling one value papers over the symptom and leaves the two sources free to drift apart again on the next edit. PL-80c chose a **rename over a re-sample** for precisely this reason — so the collision became structurally impossible rather than temporarily invisible.

- **Fix:** make the whole preview come from ONE coherent scenario — the pinned block's prose, the greeting, and the "{coverageNoteFrom} sent this along" line all describing the same handoff (e.g. Billy Thomas is covering, Jordan Fisher wrote the note, or the reverse — either, as long as all three agree). `SUB_COVERAGE_RESULT` v2's sample is already coherent (Jordan accepted, Billy is the requesting tutor) and is the reference for what right looks like.
- **Then check the sibling risk:** if `{tutorFirstName}` (or any other shared-pool variable) is being combined with per-template pinned blocks elsewhere, the same drift is latent there too. Sanity-check the other `{alertDetailsBlock}`/PL-137-pinned templates for the same shared-vs-pinned mismatch.

**Verify:** preview reads as one coherent handoff between two distinct people · no unresolved variables · `SUB_COVERAGE_RESULT` still coherent · re-test-send so Scarlett can review and flip.

**Blocks the flip:** `SUB_COVERAGE_NOTE` stays draft until this reads correctly — it's a review-surface bug, and the flip decision depends on the review.

## PL-158 (tiny) · Counselor roster affiliation lookup should use `.eq()`, not `.ilike()`

**✅ SHIPPED (Jul 27).** Roster page now `.eq()`s the lowercased email (contacts are lowercased at write, so case-insensitivity survives the operator swap). The repo-wide check found the same pattern at ~25 more sites — including the sharpest instance: the PUBLIC intake and registration forms dedupe families with `ilike` on raw form input, where a `%` could match a stranger's family record and attach a new student to it. All externally-supplied-email `ilike`s now run their operand through a new leaf `escapeLike()` (wildcards become literals, case-insensitive matching stays — the ilike sites keep ilike deliberately, since legacy mixed-case rows must keep matching). Verified against the live API before writing the fix: unescaped `a-%@x.com` matched three families, escaped exactly one. Both public write paths already lowercase upstream, so no data migration needed (all stored emails checked: already lowercase). `regress:counselor-roster` grew 12 → 14 (a `%` address matches nothing; a capitalized address still resolves).

`app/class-roster/[id]/page.tsx` scopes the no-login roster page by looking up the counselor's active affiliations with `.ilike('contacts.email', counselorEmail)`. In PostgREST, `ilike` treats `%` and `_` in the operand as wildcards — so an email containing `%` would match a broader set of contacts than the one it names, widening `schoolIds` and, with it, the set of classes the page will render.

**This is not currently exploitable and is not an incident.** The HMAC token binds the class id and the counselor email together, so nobody can mint a valid link carrying a wildcard email they don't control. It's a latent sharp edge, not a live hole — filed as hardening, not as a bug.

- **Fix:** use `.eq()` on a normalized (lower-cased) email, matching however emails are normalized at write time. If the `ilike` was there to get case-insensitive matching, keep that property explicitly rather than losing it — normalize both sides, or use a case-insensitive column/index — don't just swap the operator and silently start failing on a capitalized address.
- **Check the pattern repo-wide:** anywhere else a token-scoped or security-relevant lookup uses `ilike` on a user-supplied identifier, the same reasoning applies. `parent-view` and `counselor-view` are worth a look.

**Verify:** an address with `%` matches nothing rather than many · a capitalized/mixed-case address still resolves to its affiliation (regression guard — this is the one that breaks if the fix is careless) · `regress:counselor-roster`'s 12 checks stay green.

## PL-159 · Proposed sessions hold the slot — tentative on the tutor's calendar, confirmed on parent accept

**✅ SHIPPED (Jul 27).** All four pieces, with the state-driven worker doing the heavy lifting:
- **GCal holds:** the sync worker's proposed branch now pushes a visibly tentative `HOLD: Tutoring: {student} — {subject}` event (Google `status: tentative`, `sendUpdates=none` as always) instead of doing nothing; new-schedule proposals enqueue at creation, retiring Kelsie's manual practice. On parent accept, the SAME event patches into a normal confirmed one — verified live against Billy's real Workspace calendar: hold created tentative with the prefix, event id byte-identical across the flip, prefix and tentative status gone after. (Monthly-cycle proposals keep their portal-side hold below but don't get GCal hold events — they auto-confirm within days and blanketing every generated month in tentative events would be calendar churn without a decision behind it; say the word if you want them too.)
- **Portal-side busy:** `/api/gcal/freebusy` injects live portal holds as named blocks ("HOLD: proposed session — {student} (awaiting family confirmation)"), so the wizard grid, its conflict warnings ("a second proposal over the same slot warns before it goes out"), and the slot suggestions all treat proposed as busy — even when Google is down (holds ride the not-connected/failure responses too). Google's copies of our own HOLD events are filtered out so a conflict never lists twice.
- **First-accept-wins, structurally:** `activatePendingEngagement` claims the engagement, flips its sessions, then atomically re-checks overlap against OTHER confirmed sessions of the same tutor — on clash everything rolls back (sessions → proposed, engagement → pending), Kelsie gets an alert, and the family sees a friendly "That time was just taken… nothing is your fault" page, never an error and never a silent double-booking. New gate `regress:proposal-holds` (12 checks) covers both accept orders E2E: winner activates, loser conflicts + rolls back, exactly ONE confirmed session survives.
- **Holds expire:** `HOLD_LIFETIME_DAYS = 10` (past the +5d human alert with margin). `holdActive()` is the single rule — monthly proposals (active engagements) always hold, fresh new-schedule proposals hold, ignored ones release. The nudge sweep enqueues stale proposals' sessions and the worker deletes their hold events (verified live: expired hold's event cancelled in Google, pointer cleared) — the proposal itself STAYS confirmable; on a late accept the events simply recreate as confirmed.

Today a proposed time blocks nothing: the portal doesn't count it as busy, and nothing lands on the tutor's Google Calendar until confirmation. Kelsie bridges the gap by hand, creating tentative GCal events to hold slots while a family decides. Two failure modes: the manual hold and the portal can drift apart, and two families can be proposed (and both accept) overlapping times for the same tutor.

- **Portal-side hold:** a session in a proposed/awaiting-confirmation state counts as BUSY in every scheduling surface and conflict check — the scheduling grid shades it, and a second proposal over the same slot warns before it goes out.
- **GCal tentative event (Scarlett confirmed: yes, mirror Kelsie's practice):** at proposal time, push a hold event to the tutor's calendar through the existing gcal queue machinery — visibly tentative (e.g. "HOLD:" title prefix + tentative status), `sendUpdates=none` per the standing convention. On parent accept, the SAME event flips to confirmed (update in place, not delete/recreate — event id stays stable). On decline, counter-proposal, or proposal expiry, the hold is released and the event removed.
- **First-accept-wins, structurally:** acceptance re-checks conflicts atomically (optimistic-claim pattern, same shape as `chargeAutopay`'s claim). If two overlapping proposals are both outstanding, the first family to accept gets the slot; the second lands on a friendly "that time was just taken — here's how to pick another" state, not an error and not a silent double-booking.
- **Holds expire:** tie hold lifetime to the existing proposal expiry/nudge machinery (`sweepProposals`) so an ignored proposal can't reserve a tutor's Tuesday forever.

**Verify:** overlapping proposals E2E in both accept orders · GCal lifecycle proposed→confirmed and proposed→released (event id stable across the flip; no attendee invite noise) · grid shows the hold as busy · expiry releases both the portal hold and the GCal event · Kelsie's manual-hold workflow documented as retired in the release note.

## PL-160 · A real calendar view — GCal-style week/month, combined, color-coded

**✅ SHIPPED (Jul 27).** New `/admin/calendar` (linked from the admin nav): a GCal-style week view (time grid, 7 AM–10 PM, overlap fanning) and month view (day cells, "+n more"), fed by a new `/api/admin/calendar` combining 1-on-1 sessions, class sessions (school-timezone wall clock converted correctly), and PL-159 proposed holds. Kelsie's color language is kept EXACTLY, encoded once in a new shared `calendar-colors.ts` (the PL-161 writer will color through the same map): yellow #F6BF26 proposed · dark green #0B8043 confirmed in-person · light green #7CB342 confirmed online · red #D50000 cancelled — and cancelled renders red rather than disappearing (verified live: the Nido cancelled class shows red on the grid). Filters (person / school-or-class / status) compose; legend on the page; the America/Denver label is visible in the header AND next to the range (PL-118). Every block deep-links its record (tutoring → the family's row, class sessions → the class page) and carries a plain-English tooltip. Read-only v1 — no scheduling actions. Verified live: all three source kinds render with correct colors; a proposed fixture rendered yellow and recolored to dark green on confirm via the refreshed fetch (the today button now always refetches, so a status change recolors without reload weirdness); filters narrow correctly (cancelled-only left exactly the Nido blocks); deep links land. Built with the PL-161 overlay in mind — the color map and block feed are shared modules.

The portal has scheduling grids but nothing that reads like a calendar; Kelsie lives in Google Calendar (see the three screenshots from Scarlett, Jul 27) because it shows everything at once. Build the equivalent view in the portal.

- **One combined calendar (Scarlett confirmed):** 1-on-1 tutoring sessions, class sessions, and PL-159 proposed holds on a single week/month view.
- **Keep Kelsie's existing color language exactly** — no retraining: **yellow** = proposed/not confirmed · **dark green** = confirmed in-person · **light green** = confirmed online · **red** = cancelled. Cancelled renders red; it does not disappear.
- **Filters:** by tutor/instructor, by class or school, by status. **Timezone discipline per PL-118:** render in America/Denver with the label visible.
- **Click-through:** every block deep-links its record (session row, class page) per the standing alert/deep-link rule.
- **Read-only v1.** Scheduling actions stay on their existing surfaces — this view is for seeing, not editing. (The PL-161 suggester overlay renders on top of this view; build with that in mind.)

**Verify:** all three source types render with correct colors · a status change (confirm, cancel) recolors without reload weirdness · filters compose · Denver label present · deep links land.

## PL-161 · International classes calendar: automate the hand-managed GCal + instructor-fit suggester

The International Classes Google Calendar is maintained by hand today, with an established color code (yellow proposed, dark green in-person confirmed, light green online confirmed, red cancelled) and two kinds of value: the class-level span shows the commitment window an instructor would take on (or travel, if in-person), and the per-session blocks let Kelsie eyeball whether a candidate instructor is actually free.

- **Take over the EXISTING calendar in place (Scarlett confirmed):** the portal writes to the same calendar everyone already subscribes to. Class status transitions drive the events automatically — class-level span event colored by the code above, plus the per-session blocks from the class schedule. Cancelled recolors red rather than deleting (matching current practice — see the March screenshot's cancelled rows).
- **One-time reconciliation of hand-made events:** reuse the PL-154 XCL- audit machinery — match existing hand events to portal classes and adopt them (store the event id, take over management); anything unmatched goes to an admin report for Kelsie to resolve. Never silently delete a hand-made event.
- **Instructor-fit suggester, advisory only:** given a class's stated session times, check each candidate instructor against (a) their Google busy data — the shading machinery the tutor-week grid already uses, (b) portal commitments including PL-159 holds, and (c) in-person travel spans for the class window. Surface ranked suggestions with the conflicts named plainly.
- **Visual-first, because trust is earned:** the suggester's primary output is an OVERLAY on the PL-160 calendar — candidate's busy/free rendered against the class session blocks, so Kelsie sees exactly what the ranking saw and can disagree with it. Assignment remains her explicit click; the suggester never assigns.

**Verify:** status transition recolors the span + sessions correctly on the live calendar · reconciliation adopts matched events (id stored, subsequent updates flow) and reports unmatched ones · suggester never ranks an instructor with a hard session-time conflict as available · overlay renders the same busy data the ranking used · a hand edit to an adopted event is detected by the XCL- drift audit rather than silently overwritten.

## PL-162 (small) · Billing panel: demote the off-cycle buttons to a footnote

**✅ SHIPPED (Jul 27).** Panel now leads with the trust line — "Billing runs itself: proposals generate on the {settings day} of each month, and nudges, auto-confirm, and collections run every morning" — quoting the REAL `tutoring_generate_day` setting (ordinal-formatted), not a hardcoded 20th. The generate + sweeps buttons moved to a "▸ Run off-cycle…" disclosure at the bottom, collapsed by default, each stating its actual use case (generate: "added or fixed an engagement after this month's generation day and want the proposal out today"; sweeps: "a family just confirmed / a retry is due and you don't want to wait for tomorrow morning's run"). Buttons unchanged functionally.

Scarlett's read of the billing panel: "Billing is automatic, right? But this 'run the monthly cycle now' tab doesn't make it seem so." She's right — the off-cycle controls sit at the top of the panel looking like the primary workflow, which quietly implies the automation can't be trusted.

- **Collapse "Run the monthly cycle now" + "run sweeps" into a small disclosure at the BOTTOM of the panel** (e.g. "▸ Run off-cycle…"), collapsed by default.
- **Lead the panel with a trust line instead:** what runs automatically and when, in plain English — "Billing runs itself: generation on the {settings day}th, nudges/auto-confirm/collections daily at ~7:40 AM. You only need the controls below to avoid waiting for tomorrow's run."
- **Inside the disclosure, state the actual use case per button:** generate = "added or fixed an engagement after this month's generation day and want the proposal out today"; sweeps = "a family just confirmed / a retry is due and you don't want to wait for tomorrow morning's run."

**Verify:** panel reads automation-first · buttons still work from the disclosure · copy passes the plain-English rule.

## PL-163 (small) · Hours-exhausted flag joins the dashboard needs-attention list

**✅ SHIPPED (Jul 27).** New state-driven rows at ≤1h remaining (the default pending your threshold call): "Package hours almost used up" and, at 0, "Package hours used up" — copy in the existing voice ("{student} — 14.0 of 15h used, 1.0h left · time to talk about next steps"), deep-linking the family on the tutoring page, `since` = when the hours were actually spent (the last consuming session). Drawdown uses the billing status set across every engagement drawing on the addon. The clear condition goes one step beyond the ask: a fresh package ANYWHERE in the family with >1h left suppresses the row (the renewal conversation already happened — the row would nag a solved problem), and ending the engagement clears it too. Verified live both directions: Roman (15/15 used) and Fakey (14/15) surfaced; inserting a 5h package for Roman's family cleared his row with no email involvement; deleting it brought the row back.

The Students section already computes "15.0 of 15h used — 0.0h left · time to talk about next steps." That's a real to-do (a conversation that leads to renewal or wind-down), but it only surfaces if someone happens to open the tutoring page.

- **Add a needs-attention row per student/family at (or approaching) package exhaustion**, same live-condition machinery as the other rows (state-driven: fixing it — new package, ended engagement — clears the row; nothing is a sent-email artifact).
- Row deep-links the family on the tutoring page. Copy stays in the existing voice ("time to talk about next steps").
- Consider the threshold: appear at ≤1h remaining, not only at exactly 0 — the conversation is better had before the last session, and the existing line already knows the number. (Scarlett to confirm the threshold; default to ≤1h.)

**Verify:** exhausted fixture surfaces the row · buying/attaching a new package clears it without any email involvement · deep link lands filtered.

## PL-164 (small) · Family tutoring emails: viewable + filterable in the Communications tab

**✅ SHIPPED (Jul 27).** The PL-83 row list (state + origin badges, openable render) was EXTRACTED into a shared `FamilyCommsList` component — the family-record timeline and the Communications tab now render the identical implementation, so they can't drift. The History tab grew a family filter; picking a family swaps the table for that family's full timeline (banner + clear), and the tab's template/status filters compose with it (statuses map onto the timeline's states — delivered covers opened, etc.). The family-comms API items now carry `templateKey` to make that composition possible. Verified live: Roman's family shows 21 rows including the T7/T8/T_SCHEDULE sends with origin badges; an AL-template filter narrows to zero for that family (correct); renders open inline.

The PL-83 family-scoped comms timeline lives on the family/student record. The Communications tab — where Scarlett actually reviews what went out — can't show or filter these sends.

- **Surface tutoring/family sends in the Communications tab's sent view** with a family filter (and the existing type/status filters composing with it).
- Reuse the PL-83 row machinery: openable renders, automatic / sent-by-hand / test badges — one implementation, two surfaces, so they can't drift.

**Verify:** a family's T1/T2/T3 sends appear in the tab · filter by family narrows correctly · render opens · badges match the family-record timeline.

## PL-165 (small) · "Regenerate" says what it does, and always answers

**✅ SHIPPED (Jul 27).** The button now arms into the in-page ConfirmAction whose body states the scope in full: "Rebuilds this schedule's upcoming, not-yet-billed sessions from the weekly slots (use after editing the schedule). Sessions already on an invoice are kept as they are, confirmed or paid invoices are never touched, and no emails are sent or resent." And it always answers: the route snapshots the future unbilled session instants before and after (counts alone can't say "nothing changed" — a no-op deletes and recreates the identical set) and returns the real delta; the banner reads either "Nothing needed regenerating — all 15 upcoming sessions already match the weekly schedule. No emails were sent." or "Regenerated: N added, M removed, K unchanged…". Verified live on Roman's schedule: 15 sessions removed+recreated, reported honestly as added 0 / dropped 0 / unchanged 15. (Billed sessions were already structurally protected — `invoice_id IS NULL` in the clear query — the copy now says so.)

Two findings from Scarlett pressing it: (1) "feels a little scary — does it regenerate the invoice? The communications? Everything?" (2) "When I pushed it, nothing seemed to happen."

- **Rename/annotate to state scope plainly:** it rebuilds the DRAFT invoice's session and carried-fee lines from the current schedule — manual lines are preserved, confirmed/invoiced/paid invoices are never touched, and **no emails are sent or resent**. Put that sentence where the button is (tooltip is not enough; use the confirm dialog body or inline caption).
- **Always respond.** Every press produces a visible result: what changed ("2 session lines updated, manual lines kept") or, when the invoice already matches the schedule, an explicit "Nothing needed regenerating — the invoice already matches the schedule." Silence reads as breakage (this is the round-1 PL-152 lesson applied to buttons: the absence of feedback is itself a bug). Piggybacks on batch 18's `regress:mutation-buttons` discipline.

**Verify:** no-op press shows the nothing-changed message · a real change lists what moved · paid/confirmed invoices refuse with a plain explanation · no send occurs in either case (email_sends unchanged).

## PL-166 (tiny) · Scheduling time inputs move in 5-minute increments

**✅ SHIPPED (Jul 27).** The shared `TimeSelect` already stepped by 5; the stragglers were the raw native inputs — consultation date-time (leads page), the comms reschedule picker, tutor offer-windows, session editing in the schedule view, and both availability-grid time fields. All carry `step={300}` now. Step constrains the picker's increments and never touches stored values — an existing 4:03 still renders and can still be typed. Verified in the running app (grid inputs report step 300).

Consultation scheduling steps by 1 minute; so do the other time pickers. Nobody schedules a session at 4:03. **All scheduling time inputs (consultation, weekly slots, session editing) step by 5 minutes.** Existing stored times that aren't on a 5-minute boundary still render correctly — the step constrains new input, it doesn't corrupt old data.

**Verify:** pickers step by 5 · an existing 4:03 session still displays and edits without being silently snapped.

## PL-167 (small) · New-schedule picker polish trio

**✅ SHIPPED (Jul 27).** New shared `SearchCombobox` in admin/ui: matches render UNDER the input as you type, ↑/↓/Enter/Esc keyboard navigation, current selection shown when idle, "…and N more — keep typing" past 30 matches, "No matches — check the spelling?" when empty. `TimezoneSelect` is now a thin wrapper over it (every existing call site — class wizard, tutors panel, availability grid — picks the new behavior up with no API change), and the wizard's subject picker uses the identical component so both feel the same. Label fix shipped via a `timezoneLabel` prop on the shared AvailabilityGrid: the admin wizard passes "Student's timezone (the times above are in it)" while the public intake form keeps "Your timezone" — there the person typing IS the family, so the original label is correct on that surface. Verified live: typing "chem" surfaces both Chemistry options immediately, "madr" surfaces Europe/Madrid, keyboard select works, label reads Student's.

1. **Timezone search shows its options as you type.** Today it works but doesn't SEEM to — you type, then have to click below to discover whether it matched. Make it a live autocomplete: matching options appear under the input as you type, keyboard-navigable, exactly the pattern users expect.
2. **Subject picker gets the same treatment.** It's already searchable but looks like a plain dropdown — nothing invites typing. Same live-autocomplete pattern as the timezone picker so both feel identical.
3. **Label fix:** "Your timezone (the times above are in it)" → **"Student's timezone (the times above are in it)"** — the admin filling the form isn't the one the timezone belongs to.

**Verify:** typing in either picker surfaces matches immediately · keyboard select works · label reads Student's.

## PL-168 (small) · Weekly Schedule: sessions/week and session length actually do something

**✅ SHIPPED (Jul 27).** Session length already prefilled each new slot's duration (verified, kept); what was missing was the tally and the honesty check. The cadence row now shows a live "{n} of {m} weekly slots added" (green when they agree, amber when not), and a submit-area warning renders on mismatch — "You said 2 sessions/week but added 1 weekly slot — that's fine if intentional" — informing, never blocking (an empty slot list stays exempt: one-off-only schedules are legitimate). Verified live, including the JSX inline-boundary-space gotcha (PL-119 lesson) in the warning copy.

You can select sessions per week and session length, and then… nothing. The slot builder below ignores both and happily lets you contradict them. Either the fields drive the builder or they shouldn't exist.

- **Session length prefills each new weekly slot's duration** (still editable per slot — the field is a default, not a cage).
- **Sessions per week becomes a live tally against the slots actually added:** "2 of 3 weekly slots added" — and a plain warning when they disagree at submit time ("You said 3 sessions/week but added 2 slots — that's fine if intentional").
- Mismatch never blocks — it informs. The fields become the plan; the slots remain the truth.

**Verify:** new slot inherits the length · tally updates live · submit-time mismatch shows the warning and still allows proceeding.

## PL-169 · Weekly slots outside the student's saved availability get a warning

**✅ SHIPPED (Jul 27).** New `slotOutsideAvailability()` in availability.ts, built on the SAME family-window checker the PL-147 suggestion engine scores with (extracted, not duplicated) — occurrence-by-occurrence across the whole horizon on the STUDENT's clock, so a slot that leaves the window only after a DST shift still flags, and an off-by-timezone comparison can't happen. Flagged rows carry the inline "⚠ Outside the family's saved availability (they said: Mon 4 PM–6 PM)" quote (new `availabilitySummary()` formatter); a submit-area summary lists every flagged slot and says plainly that proceeding is allowed ("availability goes stale and phone agreements happen — just make sure it's on purpose"). Empty availability produces zero flags — unknown is never "unavailable". Verified live: Mon-4PM-Denver slot inside a Mon 4–6 Denver window → no flag; Tue → row flag + summary; the timezone-boundary case (Berlin family, Denver tutor: Mon 4 PM Denver = Tue midnight Berlin flags, Mon 8 AM Denver = Mon 4 PM Berlin doesn't) proven by direct ground-truth tests of the helper (5/5). This is one shared form, so the "Schedule now" deep-link path (batch-20 PL-184's concern) runs the identical comparison.

The form allows picking days/times outside what the family said they're available — sometimes legitimately (things change, phone agreements). But today it's silent, which defeats the entire point of collecting availability.

- **At slot entry:** a slot outside the saved availability gets an inline flag on the row — "Outside the family's saved availability (they said: Mon/Wed after 4 PM)" — quoting what they actually said, so the mismatch is checkable at a glance.
- **At submit:** if any flagged slots remain, one summary warning with the flagged slots listed; proceeding stays allowed (the availability may be stale — that's a human call).
- Compare in the student's timezone (PL-118 discipline) — an off-by-timezone comparison would flag correct slots and teach everyone to ignore the warning.

**Verify:** slot inside availability = no flag · outside = row flag + submit summary · timezone-boundary case compares correctly · proceeding past the warning works.

## PL-170 · Payment step: packages win by default, and the form knows what the family already bought

**✅ SHIPPED (Jul 27).** The wizard's package lookup went from student-scoped labels-only to FAMILY-scoped with real economics: every package any sibling bought loads with hours remaining computed across every schedule drawing on it (same status set as `packageHoursUsedBefore`, the function that actually bills — not the lighter client-side count other panels use). Picking a student now defaults funding to package whenever usable prepaid hours exist, auto-fills when there's exactly one, and greys the rate with an honest caption (the rate still matters if sessions ever run past the package — billing charges overflow at it — so the caption says that instead of pretending the field is dead). Choosing to invoice while unused hours exist gets the amber "invoice anyway?" flag naming the exact hours; proceeding stays allowed, and a package already fueling a live schedule doesn't count as "sitting unused" (no false flag) — it renders disabled in the picker as "already fueling {name}'s schedule", because billing draws a package down per schedule and attaching it twice would cover the same hours twice. That rule is enforced where it matters: **the route is now the authority** — create and update both refuse a package from another family ("That package isn't on this family's account") or one attached to another live schedule; before this, the route accepted ANY addon id unvalidated. Verified in the running app: Scar Tissue (unattached 10h) → package pre-selected + auto-filled "10.0h left" + rate greyed; switch to monthly → the 10.0h warning; Fakey McFakerson (attached 15h) → monthly default, no false warning, option disabled with the fueling label; both route refusals exercised authenticated (400s, no rows written). Out-of-scope find flagged separately: the admin panel's client-side drawdown counts fewer statuses than billing does.

Today the payment step treats every schedule as new billing, even when the family has pre-paid hours sitting unused — the exact situation where invoicing them again is a real money mistake a warning would have caught.

- **Default to package hours whenever the family has an active package with hours remaining.**
- **Single package auto-fills** — if there's exactly one, it's selected; no picking required.
- **Rate greys out when a package is selected** — the $/hour is moot (the package set the economics); an editable rate field next to a package selection implies a choice that doesn't exist.
- **Invoicing-with-package warning:** choosing to invoice while unused package hours exist gets a plain flag — "This family has 7.5h remaining on a paid package — invoice anyway?" Proceeding allowed (edge cases exist: different student, different subject-rate agreement), but never silent.

**Verify:** family with package → package pre-selected, rate greyed · one package → auto-filled · invoice choice with hours remaining → warning · family with no package → invoice flow unchanged.

## PL-171 · The form survives "change" — and interruptions generally

**✅ SHIPPED (Jul 27).** Fact-check first: in the current code, pressing "change" already preserves the student-agnostic state (verified live — subject, slots, tutor, notes all survive; the addons/availability/payment effects recompute per student, which is correct). The wipe Scarlett hit is most consistent with a page navigation or reload — which is exactly what the second half fixes: the wizard now autosaves a draft (debounced, localStorage, per this browser's admin) whenever anything meaningful is in it, and clears it when the form empties or a schedule is actually created. Coming back — including after a full reload — offers "You have an unfinished schedule from Jul 27, 5:53 PM (Scar Tissue). Resume it?" with one-click Resume and an explicit Discard. Resume restores everything through one-shot refs consumed by the derived-state effects, so a resumed draft's custom rate, location, and payment choice aren't clobbered by their own recompute-on-change logic — and a drafted package that no longer fits the student falls through to the PL-170 defaults visibly rather than keeping stale state. Verified live: fill → reload → offer with correct timestamp+student → resume restored student/tutor/slot/funding · discard cleared the draft and the form started clean · create clears the draft.

Pressing "change" on the student's name wiped the whole form. (The button's purpose: you picked the wrong student mid-flow — legitimate, occasional.) Losing all progress makes it a trap instead of a correction.

- **Changing the student preserves everything student-agnostic:** slots, subject, session length, notes. Student-specific derived state (availability comparison, package/payment step) recomputes for the new student, with anything invalidated flagged rather than silently dropped.
- **Draft autosave:** the in-progress form persists (per admin, e.g. localStorage or a draft row) so that Kelsie taking a call and navigating elsewhere mid-entry comes back to her half-built schedule, with a "resume draft from {time}?" offer and a discard option. This is the real workflow — interruptions are normal ops, not an edge case.

**Verify:** change-student keeps slots/subject · payment step recomputes for the new student · navigate away mid-entry → return → resume offer restores state · discard works.

## PL-172 (tiny) · Send-to-confirm toggle: say what OFF actually means, and fix the typo

**✅ SHIPPED (Jul 27).** Copy now: "**On:** we'll email the family to confirm the times before anything's locked in. **Off:** set it up now — the schedule is locked in immediately and the family receives it as a done deal (use this when you've already agreed to the schedule by phone or email). They won't get an approve/decline step." Typo fixed, OFF owns its consequence. Verified rendered (including the eaten-space fix after the bold labels).

The off-state copy reads "use this when you've already agreed the schedule" — (a) missing "to": **"already agreed to the schedule"**; (b) it doesn't answer the question Scarlett immediately asked: if it's off, when does the parent approve? **Answer: never — that's the point of off.** The copy should own that consequence:

> **Off:** set it up now — the schedule is locked in immediately and the family receives it as a done deal (use this when you've already agreed to the schedule by phone or email). They won't get an approve/decline step.

**Verify:** copy updated both states · plain-English rule holds.

## PL-173 (tiny) · "This week's tutoring" card always shows the proposed count too

**✅ SHIPPED (Jul 27).** Dashboard API counts `status='proposed'` over the identical 7-day window (same query shape, one extra head-count), and the card renders "+N proposed, awaiting family confirmation" whenever N > 0 — regardless of the confirmed number, per your call — and nothing when N = 0. Verified: local API returns weekSessions 9 / weekProposed 0 → no subline; the subline path exercised in code review.

The card counts `status = 'confirmed'` only — which is precise and correctly labeled, and still misled a careful reader (Jul 25: card read 0 while nine sessions sat in `proposed` one auto-confirm sweep away from confirmed; verified in prod, not a counting bug). A number that's technically right but tells half the state is the attention-surface anti-pattern.

- **Always render a second line with the proposed count for the same 7-day window** — not only when confirmed is 0 or low (Scarlett's call): e.g. "**9** confirmed 1-on-1 sessions in the next 7 days · **+3 proposed, awaiting family confirmation**." When proposed is 0, show nothing extra (a permanent "+0" is noise).
- Same query shape as the existing count (`status = 'proposed'`, same window), one extra cheap count.

**Verify:** proposed > 0 renders the subline alongside any confirmed value · proposed = 0 renders no subline · counts match a direct DB query for the same window.

## PL-174 (small) · Pipeline "Assigned to" becomes optional and quiet — but assignment now DOES something

**✅ SHIPPED (Jul 27).** The prominent grid field is gone; assignment is now a small "assign…" affordance on the lead detail (empty = normal state), with its own save so the main Save can never assign a typed-then-abandoned email. Assignment sends ONE email to the assignee via `sendAdminAlert` with new registered template `AL_LEAD_ASSIGNED` (seeded as a DRAFT for your review — code twin sends until you flip it): "{actor} assigned you a pipeline lead: {name}", body from the new leaf composer `lead-assign-copy.ts` with stage (plain-English labels now shared between the pipeline page and the email — one map, can't drift), contact, interest, age, and the deep link to the lead. Guards verified E2E on a QA lead: assign→unassign→reassign→self-assign produced EXACTLY ONE email_sends row (dedupe per lead+assignee), self-assign and unassign silent. Sample pin computed from the composer per the PL-137 rule (`regress:alert-pins` now covers 18 templates). Badge/column untouched; no assignee filter added, per the doc.

Fact check first (source-verified): assignment currently does nothing but display — `assigned_to` is stored and rendered as a name badge on the lead row. No notification, no task, no filtering. Today one person works the pipeline, so the field is ceremony — but a field that implies workflow should have at least a minimal mechanism behind it (Scarlett, Jul 27).

- **Make it optional and visually minimal** — collapse to a small "assign…" affordance on the row/detail rather than a prominent form field; empty is the normal state.
- **Assignment sends one notification email to the assignee**: "{actor} assigned you {lead name}" with the lead's key facts (name, school/subject interest, stage, age of lead) and a deep link to the lead — an action surface per the standing alert rules, not a bare FYI. Composed from a registered template so the copy is editable like everything else.
- **Guards:** no send when you assign to yourself (the common one-person case stays silent) · reassignment notifies the new assignee only · dedupe per lead+assignee so toggling doesn't spam · unassigning sends nothing.
- **Keep the rest of the machinery as-is** (column, badge). Filtering by assignee stays a future item — don't add it now.

**Verify:** assign to someone else → one email with working deep link · self-assign → no send · re-toggle → no duplicate · lead saves cleanly with no assignee · badge renders.

## PL-175 (small) · Instructors and Tutors are ONE list — including the default Zoom link

They're the same people: "tutors" in 1-on-1 land, "instructors" in class land. Today the Instructors page and the One-on-One → Tutors page are separate surfaces, and the default Zoom meeting link only surfaces in the 1-on-1 flow (it appeared when billy@ was selected as a 1-on-1 instructor) but not on the Instructors list.

- **One underlying record, one editing surface** — whatever field set the tutors page has (subjects, timezone, matching notes, default Zoom link) is the same record the Instructors page shows; the label ("tutor"/"instructor") stays context-appropriate per surface, per the position-not-name discipline.
- **Default Zoom link visible and editable from the Instructors list** just as it is in the 1-on-1 flow.
- If the two surfaces currently read different tables/columns, unify with a migration rather than syncing — synced duplicates drift (standing lesson).

**Verify:** editing the Zoom link on either surface shows on both · fields agree everywhere · no orphaned duplicate records after unification.

## PL-176 (small) · "Remove" → "Make inactive", with Active/Inactive tabs

**✅ SHIPPED (Jul 27).** "Remove" hard-DELETED the instructor row — worse than the label implied. New `instructors.active` column (migration `20260818000001`, applied); "Make inactive" hides them from every new-scheduling picker (class wizard instructor dropdown — where an already-assigned inactive instructor stays selectable so an existing class doesn't silently lose them; tutoring wizard ranked list; the continuity hints) with history fully intact and reversible. Going inactive runs the existing comms-off cascade first (sends stop, upcoming calendar events removed) and the confirm copy says so; reactivation restores picker presence and states that comms stay OFF until turned on deliberately. Active/Inactive tabs added (active default). The PL-161 suggester will read the same flag when it lands. Verified live round-trip on a QA instructor: inactive → gone from Active tab, listed under Inactive with "Make active" → reactivated back into the Active tab. No instructor-deletion path labeled "Remove" remains (the "Remove" buttons elsewhere on /admin are the class wizard's draft-session rows — a different, legitimately deletable thing).

"Remove" reads as delete — scary and wrong for people who may return (and whose history must survive regardless).

- **Rename the action "Make inactive."** Semantics: hidden from active pickers/rosters, history intact, reversible.
- **Active / Inactive tabs on the Instructors page** (active default). Inactive rows offer "Make active."
- Inactive instructors: excluded from new scheduling pickers and the PL-161 suggester; existing historical sessions/timecards untouched; `comms_enabled` implications stated in the confirm copy (going inactive turns comms off).

**Verify:** make-inactive hides from pickers, keeps history · inactive tab lists them with reactivate · reactivation restores picker presence · no deletion path remains labeled "Remove."

## PL-177 (small) · Contact Settings covers the other from-identities (info@ and billy@)

**✅ SHIPPED (Jul 27).** The registry has exactly two from-identities (`info` | `billy`) and both now live on the Contact Settings card as a "Sending identities" section: each shows its address (editable, admin-only like the rest of the card), a plain-English where-used line ("info@ — parent-facing class and billing emails, counselor updates, tutor coverage emails, and the internal [HGL Admin] alerts" / "billy@ — the personal-voice sends: thank-you, review requests, post-class offers, upsell, cancellations"), a "deploy default" tag until an override is saved, and the does-NOT-change caveat inline (a brand-new domain must be verified in Resend first; replies go wherever the inbox lives). Mechanically the identities became settings: `email_from_info` / `email_from_personal` in app_settings with the env values as fallbacks, resolved AT SEND TIME inside `sendOnce` — so every send site that passes the info/billy constants (or nothing) picks up an edit immediately, while explicit custom Froms (the tutoring contact's) pass through untouched. Verified by compile-and-call round-trip (7 checks): no-override → env values; overrides → both identities switch, custom From untouched; cleanup restores fallbacks. The tutoring point-of-contact identity was already editable on this card (PL-50) — that's the third and final sender.

Contact Settings currently explains/edits a subset of the sending identities. Extend it to the rest so a future change never requires code:

- **Each from-identity the system sends as (info@, billy@, and any others in `from_identity`) gets a row**: the address, where it's used (one plain-English line each — e.g. "info@ — parent-facing class and billing emails" · "billy@ — tutor-facing and internal alerts"), and the same edit affordance the existing entries have.
- **Small explanations inline, per Scarlett:** the point is that changing one of these someday is a settings edit with understood consequences, not an archaeology project. Note anything that does NOT change with the setting (e.g. Resend domain verification needed for a brand-new domain) right there in the copy.

**Verify:** every distinct from_identity in the templates registry appears · edits flow to real sends (test-send proves it) · explanation copy passes the plain-English rule.
