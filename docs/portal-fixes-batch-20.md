# Portal fixes — batch 20 (19 items, PL-178…196 — state-machine tier shipped; PL-195 + PL-196 ADDED Jul 28 after your pull — this line is the re-read flag)

Opened July 27 from Scarlett's email + UI review; completed July 28 with the navigation/IA restructure and the student profile page. **Do not start until Scarlett hands it off** (batch 19 first). If this doc changes after you've pulled it, wait for an explicit re-read ask.

Internal dependencies: PL-185/188 share one state machine (propose→confirm→started) — build together · PL-181 (scores) before PL-193 (profile shows scores) · PL-182 (merged form) before PL-194 (suggestions live in that form) · PL-190 (nav frame) before PL-192/193 (the surfaces it houses) · PL-186 likely falls out of PL-185 — diagnose before fixing separately.

Next PL after this batch: **PL-195**.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

## PL-178 (small) · CX_WAITLIST gets the 1-on-1 tutoring offer its WR sibling has

**✅ SHIPPED (Jul 28) — awaiting your flip.** CX_WAITLIST v3 was built FROM WR_WAITLIST_RELEASE v3's body verbatim with a mechanical guard: the script refused to proceed unless the why-sentence matched WR exactly, and asserted the final diff is precisely ONE line — the why-sentence, now "the {className} class won't be running this term, so we weren't able to open up a place for {studentFirstName} (no payment was ever taken)". Offer paragraph, {availabilityLink}, no-payment line, still-on-our-list close, {contactBlock}: byte-identical to WR. Subject per the doc ("An update on the {className} waitlist — and an option for {studentFirstName}"), preheader in WR's voice. No pricing (asserted). The send site already supplies the real tokenized availability link through emailContext, so the link resolves in real sends AND the sample (it rendered in the test-send). Because CX_WAITLIST is LIVE, v3 was inserted WITHOUT repointing — v2 still sends (verified) until you review the **test-send in billy@'s inbox** and flip v3 active.

Two sibling waitlist-closure emails, one gap. **WR_WAITLIST_RELEASE** (class ran, stayed full) carries the deliberate 1-on-1 offer — "we can help right away with **1-on-1 tutoring**… [Share your availability]({availabilityLink})" — per Scarlett's PL-59 rationale: someone who wanted SAT prep and was willing to pay should be helped asap. **CX_WAITLIST** (class cancelled, waitlist closed) is closure-only. The Jul 22 case analysis accepted that, but Scarlett's Jul 27 review overturns it (her words): "this person was on the waitlist and wants our services, and we have the capabilities to meet their needs outside of this group class that was cancelled." The family's situation is identical regardless of WHY the seat never materialized — if anything the cancelled case is stronger, since no future section of that class exists to wait for.

- **Build CX_WAITLIST's new body FROM WR's approved copy, not by patching the old one** (Scarlett, Jul 27: the waitlisted parent's experience is the same no matter why their student can't take the class — so it should essentially be the same email). Take WR_WAITLIST_RELEASE's body verbatim and change ONLY the why-sentence: "the class stayed full, and we weren't able to open up a place for {studentFirstName}" → the cancellation equivalent ("the {className} class won't be running this term"). Offer paragraph, `{availabilityLink}` machinery, no-payment line, still-on-our-list close, `{contactBlock}` — all identical to WR. No pricing in the email (that lives in the scheduling conversation, per PL-59). This means the substance is ALREADY approved copy; only the swapped sentence is new for Scarlett's review.
- **Reseed as a new version** (never overwrite; Scarlett reviews via test-send before any flip if the template is draft, or the new version goes live on save if it's already live — follow the template's current state).
- **Subject/preheader: match WR's shape** — "An update on the {className} waitlist — and an option for {studentFirstName}", preheader in WR's voice ("We couldn't run the class — but we can still help right away."); Scarlett approves the final wording.
- **Sample data (PL-56/82 discipline):** the sample must show the availability link resolving, not a bare token.

**Verify:** diff CX-W's new body against WR shows ONLY the why-sentence differing (plus subject/preheader) · render shows the offer with a working tokenized link · no pricing anywhere · test-send to billy@ for Scarlett's review.

## PL-179 (small) · Covered sessions announce themselves on the substitute's upcoming list

**✅ SHIPPED (Jul 28).** The upcoming list row now carries an amber "**Covering for {first name}**" badge (same weight as the PL-132 Class badge), state-derived from `coverage_requests` accepted-where-I'm-the-candidate — a withdrawn or onward-reassigned coverage drops the marker on its own (verified live: cancelling the request cleared the badge while the session row stayed). The note's EXISTENCE is visible without any tap: a short hand-over note renders inline on the row ("{name}'s note: …", truncated past 180 chars), "no note yet" says so, and "full handoff ↓" anchors straight to the existing handoff bundle section (note + the student's history); the student's note-history is also one tap from the same line. The **PL-160 calendar** carries the same state: covered blocks are "↷"-prefixed with the tooltip reading "covered (substitute for {name})". Own sessions unaffected (verified).

Verified state (source, Jul 27): the hand-over note IS saved — `coverage_requests.handoff_note` — and the substitute's portal has a dedicated handoff section: session, location, the note (with sender's first name), and the student's last 8 session notes (PL-111/156). The machinery is right. The surfacing has a gap: an accepted coverage session ALSO lands on the substitute's regular upcoming-sessions list looking exactly like their own sessions, with none of that context attached to the row.

Scarlett's rationale (Jul 27): an instructor knows how to get ready for their own students on autopilot — someone else's student is exactly where autopilot fails, so the covering context must find them, not wait to be found.

- **Badge the row:** a covered session in the upcoming list carries a visible "Covering for {requesting tutor first name}" marker — same visual weight as the PL-132 "Class" badge, one glance.
- **Context one tap away (or inline):** the row links straight to that session's handoff bundle — hand-over note + the student's note history. If the note is short, consider rendering it inline/expandable on the row itself; the tap should never be required to discover the note EXISTS.
- **The badge is state-driven** (from `coverage_requests` accepted + candidate = me), not a sent-email artifact, per the standing rule.
- Applies wherever the substitute sees the session: upcoming list, and the PL-160 calendar view when it lands (a covered block should carry the same marker).

**Verify:** accepted coverage → row shows "Covering for {name}" with handoff link · handoff note reachable in one tap from the row · own sessions unaffected · marker clears if coverage is withdrawn/reassigned · PL-160 (when built) renders the marker on the calendar block.

## PL-180 · Calendar edits flow BACK to the portal — two-way sync with a human gate

**✅ SHIPPED (Jul 28).** Detect always, adopt deliberately — all four pieces:
- **Detect:** `auditTutoringTimeDrift()` compares future confirmed/proposed sessions against their live calendar events (one events.list per tutor), maintaining a new `calendar_drift` table (migration `20260818000007`, applied) — refreshed by the daily sweep AND a scan on tutoring-page load, so detection isn't a day behind. Sessions with a pending sync-queue row are skipped: the portal is mid-push, which is also what makes adopt/revert converge instead of re-flagging (verified: zero drift on re-scan after resolution). Hand-DELETED events are detected too.
- **Attributional, everywhere:** the alert, the dashboard's urgent needs-attention row, and the tutoring-page banner all say WHO — "**Billy moved Ada's Saturday Physics session in their Google Calendar — 2:00 PM → 3:00 PM.** The family hasn't been told and billing hasn't changed." The schedule grid marks drifted session blocks ⚠ with the same phrasing in the tooltip.
- **Resolve, one click each way:** **Adopt** runs the NORMAL reschedule machinery — the route's reschedule block was EXTRACTED into `rescheduleSession()` so the staff action and the adopt are literally one code path (tombstone + replacement, 24h fee classification, event move, T3 family notice). Never a back door — verified E2E against Billy's real calendar: a hand-moved event adopted → original tombstoned `rescheduled` with the attributional note, replacement at the calendar's exact time, **T3_SCHEDULE_CHANGE actually sent**. **Revert** re-enqueues the state-driven sync, which patches the event back (verified: the second hand-moved event returned to the portal time in Google) — and recreates hand-deleted events.
- **The accelerator (per-tutor auto-adopt)** is left for your call at review, as written — everything is gated today.

Scarlett moved a tutoring session directly in the billy@ Google Calendar and the portal never noticed (Jul 27). She's right that this can't be prevented — tutors live in their calendars, and an event that LOOKS draggable will get dragged. Today the sync is one-way (portal → calendar, with portal-side edits patching drifted events), so a calendar-side edit silently forks reality: the tutor's calendar says one time, the portal — and everything it drives — says another.

Why not silent two-way: a session time is not just a calendar fact. It drives parent schedule notices (T3), billing lines, timecards, and attendance. Silently adopting a calendar drag would let one gesture in Google bypass the notice/urgency machinery (PL-81), the late-reschedule fee logic, and the family's approved schedule. So: **detect always, adopt deliberately.**

- **Detect:** extend the existing drift machinery (the XCL- audit pattern, already comparing portal sessions to calendar events) to tutoring session events — compare on the sweep AND on tutoring-page load, so detection isn't a day behind.
- **Surface — and say WHO, not just WHAT (Scarlett, Jul 28):** the alert is attributional, not neutral. The portal knows what it last wrote to the event, so a differing calendar state means someone edited it calendar-side — on the tutor's own calendar, that's the tutor. Copy shape: "**Billy moved Ana's Tuesday session in his Google Calendar — 4:00 → 5:00.** The family hasn't been told and billing hasn't changed. Adopt (runs the normal reschedule) or revert his calendar." A neutral "mismatch" framing hides the two facts that drive the decision: a person made a change, and none of the machinery has run. Needs-attention row + a marker on the session row; deep-link per the standing rule.
- **Resolve, one click each way:** **Adopt** runs the NORMAL reschedule machinery with the calendar's time (parent notice, fee logic, timecard implications — everything a portal-side reschedule would do), so adopting is never a back door. **Revert** patches the calendar event back to the portal's time (which the sync already knows how to do).
- **Optional accelerator, Scarlett's call at review:** if the same tutor's calendar edits are adopted routinely, a per-tutor "auto-adopt with notice" setting later — start gated, earn the automation.

**Verify:** calendar-side time drag → detected on next sweep AND on page load · adopt fires the reschedule path (T3/urgency/fee logic all engage, verified against a <24h session) · revert restores the calendar event · portal-side edits still patch outward untouched · no detection loop (adopt/revert converge, don't re-flag).

## PL-181 (small) · Test scores live everywhere the student does: profile, class roster, and 1-on-1

**✅ SHIPPED (Jul 28).** Two pieces. (1) **The group read:** new `ClassScoresGrid` (app/components/ClassScoresGrid.tsx) mounted below ScoresEntry on BOTH class surfaces (admin class card + instructor portal roster) — students as rows, Diag 1 / Diag 2 as column groups with per-section inputs, computed totals (never typed), a Δ column (Diag 2 − Diag 1, green/red), per-column "taken on" date, one Save for the whole sitting. Same store, same payload shape as ScoresEntry (source/recorded_by included); entry is scoped to THAT class exactly like ScoresEntry, so a student's 1-on-1 diagnostics are never grabbed by an update. Out-of-range sections highlight red and refuse with a named plain-English reason ("Reggie (Second diagnostic): EBRW out of range for the SAT") while the valid rows still save. (2) **Scores follow the student:** ScoresEntry's history list now shows the student's FULL history across contexts — a 1-on-1 score appears on the class card tagged "from 1-on-1", a class score appears on the tutoring page tagged "from SAT Prep class" (both directions browser-verified); out-of-context rows are read-only there (edited at their source), and slot-replacement only considers rows recorded on the current surface. Verified live: column entry saved 3 students in one click (totals 1190/1160/1410), Δ rendered +70 after Diag 2, values persisted across reload, and the instructor portal loaded the same rows under instructor RLS. The student profile surface is PL-193's (this store feeds it). No migrations — `student_scores` was already the one table.

Scores exist (the milestone machinery, counselor-view display), but entry/viewing doesn't follow the student. Classes ALWAYS include two diagnostics, and instructors read those results as a group; 1-on-1 students often have diagnostics too.

- **One score store, three surfaces:** (1) the student profile — view + enter, full history; (2) the class page/roster — view + enter for that class's students as a group (the instructor's two-diagnostics workflow: enter a column of scores in one sitting, see the group side by side); (3) the tutoring page — the existing milestone entry stays, backed by the same store.
- Class surface supports the group read: per-diagnostic columns (Diag 1 / Diag 2), students as rows — the "is this group moving" glance the instructors actually do.
- Same score visible from every surface the moment it's entered on any of them (one table, no syncing).
- Role visibility follows existing rules (counselor sees what counselor-view already grants; parents unchanged).

**Verify:** score entered on the class roster appears on the student profile and tutoring view instantly · group grid renders both diagnostics · history preserved · role-gated correctly.

## PL-182 (small) · One prospective-student form: quick add and full add merge

The quick add "on a phone call" flow and the full add-prospective-student form are nearly the same thing with an arbitrary wall between them. Remove the wall (Scarlett, Jul 27):

- **Remove the separate "on a phone call" quick add.**
- **One add-prospective-student form where everything except the bare minimum is optional** (minimum: enough to identify them — name; whatever contact info exists). Kelsie enters whatever she has at the time; the rest arrives via the intake sheet anyway, which is where completeness is actually enforced.
- The form should make partial entry feel normal, not like an error state — no required-field noise on fields the intake sheet will fill.
- **Completeness still gates the right things downstream:** whatever currently requires full info before a student starts (intake complete markers, scheduling) keeps requiring it — this changes where data ENTERS, not what's required to proceed.

**Verify:** add with name only → saves, appears in pipeline · intake sheet later fills the gaps onto the same record (no duplicate) · downstream gates still hold · the old quick-add path is gone and nothing references it.

## PL-183 (small) · Intake form: conditional required phone + a real submission landing

**✅ SHIPPED (Jul 28).** Choosing contact-the-student now marks the student's phone required THE MOMENT the option is picked — required star on the field, `required` on the input, the consequence stated at BOTH ends ("We'll need the student's phone number (section 1) for this" at the choice; "You chose contact-the-student below, so we need their number" at the field) — enforced again at client submit and a third time server-side in the API (a bypassed form still gets the plain 400: "…add it in section 1, or pick contact-the-parent instead"). Other arrival options leave the field optional. Submission now LANDS: a real success page — "your answers went through" plus what happens next in plain language (reviewed within one business day, a proposed-times email built from the shared availability, nothing booked until confirmed, we reach out the way you asked) — and the failure path renders its error at the submit button, never white. Verified live: option flip → required + notes appear; API refuses student-contact-without-phone (400) and accepts the parent option; a completed submit renders the done state on revisit.

Two findings from Scarlett running the intake form (Jul 28):

- **Conditional requirement:** choosing "If the student hasn't arrived, contact the student" makes the student's phone number REQUIRED — you can't promise to contact someone you have no number for. Enforce at selection time (field marked required the moment that option is picked, plain inline explanation: "you chose contact-the-student, so we need their number") and at submit. The other arrival options leave the field optional as today.
- **Submission must land somewhere:** submitting currently ends in a blank white screen. Replace with a success page: confirmation that it went through, and WHAT HAPPENS NEXT in plain language (who reviews it, what email to expect, rough timeline). A form that ends in white space reads as "did that even work?" — the family's very first interaction with the portal should not end in doubt. (Batch-18 `regress:mutation-buttons` discipline applied to public forms: every submit produces a visible outcome.)

**Verify:** contact-student option → phone required both live and at submit, other options unaffected · successful submit → success page with next-steps copy · failed submit → visible error, never white.

## PL-184 (small) · "Schedule {student} now" pre-fills the subject — and the availability guard applies HERE

**✅ SHIPPED (Jul 28).** The deep-linked wizard now prefills the subject from the closest match, in confidence order: a prior engagement's subject → the intake sheet's stated subjects (name-matched against the catalog) → the class they came from (class-type match). Editable — a prefill is a default, not a decision; picking something else stays one click and the live combobox makes the prefill visible rather than sneaky. The PL-169 guard is structurally shared (one form, both entry paths) and was verified firing ON the deep-link path: schedule-now for Roman arrived with student AND subject (French — his most recent engagement) prefilled, and an out-of-availability Sunday slot flagged with the family's quoted windows.

From the admin/manager email button into the scheduling form: the student pre-fills but the subject doesn't. Scarlett picked a wrong subject and built sessions outside the student's availability without any warning — the resulting welcome email carried bad info to the family (see PL-185 for the sequencing half).

- **Pre-fill subject to the closest match** from what the portal already knows (intake sheet's stated subject/goal, the class they came from, prior engagements). Editable — prefill is a default, not a decision.
- **Make sure PL-169's outside-availability warning (batch 19) fires on THIS entry path too** — same form or not, the deep-linked schedule-now flow must run the same availability comparison and warning. If batch 19 already lands it structurally (one shared form), this is a verify-only line; if the flows diverge anywhere, unify them.

**Verify:** email button → form arrives with student AND subject pre-filled · wrong-subject still selectable (with the prefill making it deliberate) · out-of-availability slot warns on this path exactly as PL-169 specifies.

## PL-185 · Welcome email must wait for confirmation — it raced the confirm request

**✅ SHIPPED (Jul 27).** The trigger site was exactly the "created = done" disease: the engagement-create route fired the T8 welcome (first-engagement check) in the same `after()` as the confirm request. Now: **ON path** sends ONLY the confirm request at propose time; the T8 welcome AND the §4c all-set email fire at the confirm transition (`activatePendingEngagement` — family click and staff override both). **OFF path** sends welcome + all-set immediately and no confirm email exists at all. The one-welcome-per-FAMILY rule moved INTO `sendWelcomeHandoff` itself (checks email_sends for a prior real T8 to the family), so every caller — create, confirm, override, siblings, repeats — is safe by construction, on top of the per-engagement sendOnce dedupe. Verified E2E against the dev server: ON create → exactly `T_SCHEDULE_CONFIRM`, no welcome; confirm → welcome once, re-confirm deduped; OFF create → welcome immediately, no confirm email. (T_SCHEDULE_SET reached its send site in the right order both paths; in dev the PL-60 dead-link guard blocks its `webcal://` href — dev-only, pre-existing.)

The sequencing failure (Jul 28): the family's tutoring welcome email went out AT THE SAME MOMENT as "Please confirm {student}'s tutoring schedule." The welcome presumes a schedule the family was simultaneously being asked to approve — and in Scarlett's test it carried wrong info (wrong subject, out-of-availability times), so the family's first impression was a confident email about a schedule nobody had confirmed.

- **Gate the welcome on confirmation:** when send-to-confirm is ON, the welcome sends only after the family confirms (or after staff manually confirm in the portal on their behalf). Proposal email at propose time; welcome at confirm time. Never both at once.
- **When send-to-confirm is OFF** (already-agreed path, PL-172): the welcome may send immediately — that's the meaning of off — but then no confirm email should exist at all. The invariant: **a family never holds a welcome for a schedule they're still being asked to approve.**
- Audit the trigger site: whatever fires on schedule creation currently treats "created" as "done." The state machine already knows proposed vs confirmed — the sends must key off the right transition.

**Verify:** ON path → propose sends only the confirm request; family (or staff) confirm → welcome sends once · OFF path → welcome immediately, no confirm email · no path sends both simultaneously · dedupe holds on re-confirmation.

## PL-186 (small) · "Confirm this schedule" button: find and fix the initial failure

**✅ SHIPPED (Jul 27).** **Diagnosis (documented per the ask):** the suspects were checked in order — records commit BEFORE the response (emails ride `after()`), so the token page can't see uncommitted state; the token is a stable HMAC of the engagement id, so no state-change invalidation. What remains — and fits "first press did nothing, worked later" exactly — is hydration: the confirm button was a client `onClick` firing a fetch, and a click in the window between first paint and JavaScript hydration is silently dead. Families click the moment the email lands, which is precisely that window. **Fix:** the confirm press is now a NATIVE `<form>` posting to a server action — it works from first paint, with slow JS, or with no JS at all; the outcome returns server-rendered via redirect (`?result=approved` / the PL-159 `slot_taken` friendly page / a stale-state page), so no path is ever a dead click. Decline keeps the client flow (it requires a typed note — hydration has long finished). **Immediate-click E2E:** the served HTML was replayed as a pure no-JS form POST (the worst case) → 303 to `?result=approved`, engagement active with `parent_approved_at` stamped, welcome fired at the transition, and the result page renders "Locked in — thank you!".

Scarlett's first press of the confirm button in the "Please confirm" email did nothing; it worked later. Intermittent failures on THE conversion-critical button — the one action we ask of the family — can't be shrugged off, and "worked the second time" usually means a race.

- **Reproduce and diagnose first** (standing lesson: drive flows to completion before calling gaps defects — but this one Scarlett hit directly). Likely suspects, in order: the tokenized page depending on a record/state not yet committed when the email arrives instantly (the PL-185 race would do exactly this — proposal email sent in the same breath as record creation); token minted against state that changes; the GET-safe/JS-executed-POST pattern failing silently on first load.
- **Whatever the cause: the button must never silently do nothing.** Failure states get the friendly tokenized-page treatment (aged-out / not-ready / already-confirmed), never a dead click.
- Add the first-click case to the E2E: email link followed IMMEDIATELY on arrival (the real family behavior — they click when it lands).

**Verify:** repro attempt documented · root cause fixed · immediate-click E2E green · every failure mode renders a plain-English state page.

## PL-187 (small) · Schedule phrasing: end times, and batch same-time days

**✅ SHIPPED (Jul 28).** There was already exactly ONE composer (`scheduleSummaryText` — grep proves the confirm page and the T_SCHEDULE_CONFIRM/SET emails are its only weekly-phrasing emitters; the class-collateral phrasing is a separate bilingual product surface), so the fix is one function: days sharing the same time AND duration batch with the range — "Wednesdays, Fridays, and Saturdays from 4:00 – 5:30 PM, starting July 24" — no per-day time repetition, no "90 minutes each" (the end time carries the duration); mixed durations group into one clause each; Oxford-comma joins; shared meridiem stated once ("4:00 – 5:30 PM") but cross-meridiem keeps both ("11:30 AM – 1:00 PM"); family-timezone rendering unchanged (PL-118). Per your note, **Fakey's duplicate "Mon 16:00, Mon 16:00" slot is a test case**: identical duplicate slots read ONCE — the sentence doesn't stutter even when the data does. 7 composer checks pass (batch, mixed, single-day, duplicate, cross-meridiem, Berlin-family conversion, empty). The `{scheduleSummary}` sample updated to the new shape.

Everywhere a weekly schedule is written out (emails, portal, proposals), the composer currently produces: "Wednesdays at 4:00 PM and Fridays at 4:00 PM and Saturdays at 4:00 PM, starting July 24 — 90 minutes each."

- **Batch days that share the same time AND duration, and show the range:** "Wednesdays, Fridays, and Saturdays from 4:00 – 5:30 PM, starting July 24." No repeating the time per day, no "90 minutes each" — the end time carries the duration.
- **Mixed schedules group naturally:** a student with 90-min and 60-min sessions gets one clause per group — "Wednesdays from 4:00 – 5:30 PM and Saturdays from 4:00 – 5:00 PM, starting July 24."
- One composer function, used by every surface that writes a schedule (emails, T1 proposal, portal displays, welcome) so the phrasing can't fork — find existing schedule-phrase call sites and unify on it.
- Oxford-comma list join per the existing list-join helper if one exists; times in the family's timezone per PL-118.

**Verify:** same-time-same-length 3-day case renders the batched single clause · mixed-duration case renders grouped clauses · single-day unchanged-but-with-end-time · every emitting surface uses the shared composer (grep proves no stragglers).

## PL-188 · Pipeline rows tell the truth: a "proposal sent" stage, and actions that know the state

**✅ SHIPPED (Jul 27) — built against the same state machine as PL-185.** (1) Proposing now moves the lead to **"Proposal sent"** (the stage existed in the label map; the route was skipping it straight to Started) — Started happens inside `activatePendingEngagement`, i.e. on family confirm or staff confirm, exactly the PL-185 transition; the already-agreed OFF path still starts immediately. Verified E2E: ON create → `proposal_sent`, confirm → `scheduled`; OFF create → `scheduled` directly. (2) The detail panel's intake button now knows completion: with intake answers on file it reads "✓ Intake complete — answers below" instead of offering a re-send next to the visible answers; re-send only shows while intake is actually outstanding. (3) The stale blue "Schedule {student}" button: `proposal_sent` rows now read "proposal sent — waiting on the family" (linking the schedule) instead of re-offering scheduling, and the pipeline page refetches on window focus/visibility — scheduling happens on the tutoring page while the pipeline tab sits open, so coming back now shows the advanced stage with zero manual refreshes. (4) The consultation block greys out (with the plain reason "proposal already sent — the consultation moment has passed") once the proposal is out — greyed, not hidden, so the sequence stays legible.

Four findings from one test student (Scarlett, Jul 28), all the same disease — the pipeline row and its actions don't track the student's actual state:

- **Wrong stage:** sending the schedule out for approval moved the student to "started." It should read **"proposal sent"** — a distinct stage between scheduling and started. "Started" happens on confirmation (family confirms, or staff confirm in-portal — the PL-185 transition), not on proposal. Same premature "created = done" root as PL-185; fix them against the same state machine.
- **"Re-send intake form" offered when intake is already complete** — the answers were visible right below the button. When intake is complete, that action becomes "View intake answers" (or disappears); re-send only shows while intake is actually outstanding.
- **Stale "Schedule Student" button after scheduling** — the blue button persisted and the student needed several refreshes to drop off the pipeline. Actions and pipeline membership re-derive from current state on every render, and the mutation that schedules/graduates the student refreshes the row immediately (the deep-link/late-mount discipline applied to state: no surface shows an action the state no longer supports).
- **Consultation greys out once a proposal has been sent** — by that point the consultation moment has passed; offering it implies a step backward. Greyed with a plain reason ("proposal already sent"), not hidden, so the sequence stays legible.

**Verify:** propose → stage reads "proposal sent," started only on confirm · completed intake shows view-not-resend · scheduling immediately clears the button and (on the right transition) removes the row without manual refresh · consultation greyed with reason after proposal · every action's visibility matches a state predicate, asserted in the E2E.

## PL-189 (small) · Phone consultations: record the fact, skip the calendar

**✅ SHIPPED (Jul 28).** The consult block in the lead detail gained the second door: "…or it already happened on the phone" — date (defaults today) + optional notes → `record_phone_consult`. It's a record, not an appointment: no calendar event for anyone, no scheduling machinery; the caller is stamped as the owner, notes append to the lead record ("Phone consult 2026-07-27: …"), and the pipeline advances to Consult done exactly as if a scheduled one had completed. New `consult_mode` column (migration `20260818000005`, applied) so surfaces SAY which kind it was — the detail line reads "· by phone (already happened — no calendar event)" instead of guessing from a missing event id; the scheduled path stamps 'scheduled' and is otherwise unchanged. Verified E2E: record → status consult_done, mode phone, owner stamped, notes on the record, `consult_gcal_event_id` null.

Kelsie runs consultations two ways: sometimes she schedules a formal meeting for later (belongs on calendars), and sometimes the consultation just HAPPENS on the phone when a family calls. Today the scheduler only models the first.

- **Add a "phone consultation — already happened" option** alongside scheduling one: date (defaults to today), optional notes. No calendar event for anyone, no scheduling machinery — it's a record, not an appointment.
- **It lands on the family record** like any other consultation: visible in the timeline/history, satisfies whatever "consultation done" state the pipeline tracks (so the pipeline stage advances exactly as if a scheduled consultation had completed).
- The scheduled-meeting path is unchanged; this is a second door into the same recorded fact.

**Verify:** phone consult recorded → family record shows it, pipeline treats consultation as done, no calendar event exists anywhere · scheduled path unchanged · notes visible to admin/manager per existing visibility rules.

## PL-190 · Navigation restructure: six topline tabs, everything filed

The sidebar has grown one link per feature; Scarlett's IA (Jul 28) reorganizes it into topline tabs that are always clickable, with today's pages filed under them:

- **Topline: Dashboard · Prospective Students · Tutoring · Classes · Contacts · Settings.**
- **Classes** ← Add a new class · Live class rosters · School contacts · Branding & Collateral.
- **Contacts** ← Students · Parents · Instructors · School contacts (second home — it lives BOTH under Classes and Contacts) · Communications · Agreements.
- **Settings** ← QuickBooks · Google Calendar · Contact Settings.
- Topline tabs are always clickable (land on the section's most useful default — e.g. Contacts → Students); filed pages reachable as sub-navigation within the tab. Existing deep links (`/admin?class=…`, `/admin/tutoring?family=…`, every emailed alert URL) MUST keep working — alerts in old emails outlive any nav change (deep-link-survives standing rule).
- "Students" and "Parents" as Contacts entries are NEW surfaces — they're PL-192/193; this item is the frame they land in.

**Verify:** all six tabs clickable → sensible defaults · every pre-restructure URL still lands (crawl the emailed-link inventory) · School contacts reachable from both homes · no orphaned pages.

## PL-191 (tiny) · Recent Activity gains a Schedule category

**✅ SHIPPED (Jul 28).** The dashboard feed now carries Schedule events — proposals sent ("Schedule proposed to {family} ({subject}) — awaiting their confirmation"), confirmations, and session moves/cancellations (family self-serve moves labeled as such), each deep-linking the family. Same feed machinery, one more source: the chip derives automatically from the type (PL-134), day-grouping collapses busy days ("3 schedule ▸"), and the tutoring page's family-scoped list is untouched. Verified live: the Schedule chip renders, filters, and its rows group/expand like every other category.

The dashboard's Recent Activity chips are All / Availability / Payments / Prospective students / Registrations. Schedule events (currently living in 1-on-1 Tutoring's "recent parent activity") join the dashboard feed as a **Schedule** chip — proposals sent, confirmations, reschedules, cancellations. Same feed machinery, one more source; the tutoring-page view can stay as the family-scoped subset.

**Verify:** schedule events appear in All and under the Schedule chip · chips still compose · tutoring page unaffected.

## PL-192 · Contacts is a two-way directory: Students ↔ Parents

Kelsie's referential habit comes from QBO, where Students are the main contacts with parents attached — so student-first search must work. But parent-first must too (a parent calls; you know the parent's name).

- **Contacts → Students:** search by student name → student entry shows their parents AND siblings (other students sharing the family).
- **Contacts → Parents:** search by parent name → parent entry shows their connected students.
- Both directions land on the same underlying records (family machinery) — two indexes into one truth, not two lists. Clicking a student anywhere opens the PL-193 profile; clicking a parent shows the family view.

**Verify:** student search surfaces parents + siblings · parent search surfaces students · both reach the same records (edit via one path, visible via the other) · search handles partial/typo'd names reasonably.

## PL-193 · The student profile page: everything we know, one organized place

Clicking a student — from Contacts, the pipeline, a roster, anywhere — opens a profile page with all we know, organized:

- **People:** parents (with contact info), siblings.
- **Contact information:** student's own (email, phone, school, grade).
- **Money:** rates, packages, past invoices — the family billing slice scoped to this student where per-student, family-level where shared.
- **Agreements:** status + history.
- **Communications:** the family-scoped comms timeline (PL-83 machinery; PL-164's surfacing), filtered to this student's family.
- **Schedule, past and current:** consultation (when, who conducted it — including PL-189 phone consults) · 1-on-1 tutoring (engagements, sessions) · classes taken · with the two class diagnostics' scores inline on the class entries (PL-181's store) · any other test scores.
- **Entry behavior stays familiar:** the Students list keeps current/most-recent students auto-visible with recent activity (as today) and is searchable by name; the CLICK now lands on this profile instead of dead-ending.
- Role visibility follows existing rules throughout — this page aggregates, it does not widen access.

**Verify:** every listed section renders from its existing store (no new duplicated data) · profile reachable from Contacts, pipeline, rosters · scores/consults/comms match their source surfaces exactly · role-gated.

## PL-194 (small) · Pipeline stops letting you add the same student twice

Because nothing suggested existing students while typing, Scarlett added the same test student three times — once with a typo, once exactly identical. Every duplicate is a future data-merge headache.

- **As-you-type suggestions in the add-prospective-student form** (the PL-182 merged form): matching existing students/leads appear while typing the name — including fuzzy/typo matches — with enough context to recognize them (parent name, school, stage). Selecting one opens the existing record instead of creating.
- **Exact-match guard at save:** creating anyway (legitimate: two different Ana Garcías) requires walking past a plain warning — never silent.
- Match against BOTH pipeline leads and enrolled/active students — the duplicate Scarlett created existed in the pipeline itself, but a lead duplicating an enrolled student is the same disease.

**Verify:** typing an existing name surfaces the suggestion with context · selecting opens the record · exact-name save warns and requires explicit proceed · typo'd near-match still suggests · distinct same-name students remain creatable.

## PL-195 · A failed generation is a STATE on the family, not just a flash — with the retry attached

**✅ SHIPPED (Jul 28).** New `generation_failures` table (migration `20260818000006`, applied — one row per family+period, staff-readable): the generation run upserts a row per failing family (error text + last attempt) and DELETES it for every family that completes — state-driven both directions, sweep and manual retry alike; a scoped retry that ends clean clears its families even when the fix was ending the broken engagement. **Family card:** persistent red marker per the hours-exhausted styling — "August invoice couldn't be generated — {error}. They didn't get their automatic invoice. Retrying automatically on the hourly sweep; last attempt {time}. Retry now for this family" — with the inline always-respond result (PL-165): "Fixed — N sessions created, M invoices proposed. The warning clears itself." or the fresh error text right there. **Retry now** runs the PL-144 per-family machinery scoped to that family (never stamps the month's marker). **Dashboard:** an urgent "Invoice generation FAILING" needs-attention row per failing family, deep-linking the family card, aged from first failure — discovery no longer depends on the email. Verified live: marker + retry render on the family card; retry on a fixed family cleared the row (and the dashboard row) with no refresh weirdness; the dashboard row renders urgent with the deep link. **The seeded drill is armed in prod:** Roman's family carries the fixture row (clearly marked seeded) matching the seeded alert email — the card shows the marker, and pressing "Retry now" will run the idempotent per-family generation and clear it, which is exactly the Aug-20 drill.

Added Jul 28 after the PL-144 seeded-alert click test. The deep link works — Scarlett landed on the tutoring page with the failed family's card ringed blue — but the ring fades, and then nothing on the page says what happened or what to do. Scarlett: "They didn't get their automatic invoice, right? The momentary highlight is nice to draw my attention but it needs a more permanent warning with an action attached." She's right, and this is the state-driven-attention rule applied to generation failures.

- **Persistent failure marker on the family's card/row** while the target month's generation has failed for them and not yet succeeded: plain-English line ("July invoice couldn't be generated — {error text}. Retrying automatically; last attempt {time}."), red per the existing hours-exhausted styling. **State-driven both directions:** appears from the failure record, clears itself the moment a later run (automatic or manual) succeeds — never an email artifact.
- **Action attached: "Retry now for this family"** — runs generation for just that family (the PL-144 per-family machinery already supports restriction), inline result per the PL-165 always-respond rule: what got created, or the same error text back if it failed again (which usually names the broken record — surface it, don't make her hunt).
- **Needs-attention row on the dashboard** for any family in this state, deep-linking the family — so discovery doesn't depend on the email at all.
- The seeded QA failure currently in prod is the natural fixture; purge sweeps it.

**Verify:** seeded failure → marker renders with error text + retry action · retry-now on a fixed family generates and CLEARS the marker (and the dashboard row) without refresh weirdness · retry on a still-broken family re-renders the error inline · automatic sweep success also clears it · no marker anywhere once generation succeeds.

## PL-196 (tiny) · AL_LEAD_ASSIGNED says who by NAME, not email address

**✅ SHIPPED (Jul 28).** The leads route resolves the acting admin's display name from their instructor record (the staff are instructors), falling back to the email only when no name exists; the PL-82 sample pin now shows "Scarlett Thomas" so the preview reads truthfully. Verified E2E on dev: the assignment send's subject reads "[HGL Admin] Billy Thomas assigned you a pipeline lead: …" with no address in sight. Ready for your flip of the last draft.

**Also shipped alongside (Jul 28, your item 2): the International Classes sync got an explicit ENABLE switch — configuration no longer equals activation.** The cutover is now three separate acts, and the GCal panel says so: (1) save the calendar id — changes nothing; (2) "adopt hand-made events" — runs while sync is OFF, which is the intended order; (3) press Enable — only then do sync-now and the daily sweep write to the subscribed calendar. Sync-now refuses with a plain explanation while disabled, and there's a visible sync ON/OFF state. Adopt re-runnability confirmed: new permanent gate `regress:intl-calendar` (12 checks) proves a re-run adopts only still-unmatched events (already-adopted ids are skipped), keeps reporting the unmatched, deletes nothing — so after the real class import, running adopt again will match the 13 real classes exactly as designed. The prod settings remain CLEARED; re-arming is the cutover step, on your signal.

First real send observed (Jul 28): "[HGL Admin] billy@highergroundlearning.com assigned you a pipeline lead: QA-PL174 Student." The actor should be a person, not an address — "Billy Thomas assigned you a pipeline lead: …" — in the subject and anywhere `{actor}` renders in the body. Resolve the acting admin's display name (instructors/contacts record, or the admin user's profile name) and fall back to the email only when no name exists. Update the template's PL-82 sample to show a name so the preview reads truthfully.

**Verify:** send shows "Billy Thomas assigned…" · no-name fallback still renders the address · sample matches.
