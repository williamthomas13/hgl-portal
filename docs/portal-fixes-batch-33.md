# Portal fixes — batch 33 (ACCUMULATING — opened Aug 8, 2026)

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped · registry template edits ship as new versions via anchor guards · verify composed blocks via the composer path · inline confirm banners only · NO native browser dialogs · **TEST-SEND RULE (Scarlett, Aug 8): while we're pre-launch, every test/QA email goes to billy@ (or billy+*@) ONLY — never to info@, kelsie@, or any other real @highergroundlearning.com inbox.** That includes alert-subscription fan-outs (PL-309): don't seed or exercise subscriptions that would deliver QA alerts to anyone but Billy until Scarlett says otherwise.

## PL-323 — Block-ending continue flow v2: choose-your-hours, auto-drop default, and session reservation (Scarlett, Aug 8 — extends PL-299; her copy below goes live ONLY once the flow it describes exists)

**A. The default is auto-drop.** When a prepaid block's hours run out with no confirmation, the student's scheduled sessions DROP OFF the calendar at the exhaustion point — that is the default, not just "no billing". (PL-299 shipped scheduling holds; this extends to: future sessions past the block are actually released/cleared from tutor calendars, so "the sessions simply stop when your prepaid hours are gone" is literally true.)

**B. Continue is a choice, not perpetuity.** The portal "Continue tutoring" button opens a chooser: **5 hours · 10 hours · 15 hours · until I cancel** (5/10/15 = a new hours block at the correct post-class rate for their provenance — PL-322 rates; "until I cancel" = the standard monthly plan). Parents who bought a block shouldn't have to commit to open-ended billing with one click.

**C. Reservation with conflict handling.** After the parent chooses, the portal attempts to reserve the continuing sessions (same tutor only) using the SAME session-picker architecture built for rescheduling — looking far enough ahead to cover the chosen amount. Clear times → reserved, parent sees confirmation. Conflict or the parent can't find times that work → it routes to staff exactly like a reschedule request ("we'll figure it out for you"), and staff get an alert. Parent is alerted of the outcome either way.

**D. Rate correctness.** {tutoringHourlyRate} composes from the family's own engagement (already true); the CONTINUING rate must follow the student's domestic-vs-international provenance via the PL-322 rule, one source with the price list.

**E. Scarlett's copy (exact strings — publish as the new BL_BLOCK_CONFIRM version WHEN A–C exist; formatting as current draft; {studentTutorName} composes the student's tutor):**
Subject: {studentFirstName}'s tutoring hours are almost used up — one quick confirmation
Preheader: {blockHoursLeft} of {blockHours} hours left — confirm to continue
> Hi {parentFirstName},
>
> A quick heads-up: {studentFirstName} has **{blockHoursLeft} left of the {blockHours} tutoring hours** you purchased.
>
> When those hours are used up, tutoring can continue on our standard 1-on-1 plan — same tutor, same schedule — billed monthly at **{tutoringHourlyRate}/hr**.
>
> **Please confirm if you'd like to continue**: open your family portal (no password needed) and use the "Continue tutoring" button (or just reply to this email) and we'll keep the times reserved for {studentFirstName}. If you're not sure what makes the most sense, please respond to this message; we'll get all the info from {studentTutorName} and make an action plan.
>
> [button:Open your family portal]({portalLink})
>
> If we don't hear from you, nothing bills past the hours you purchased — the sessions simply stop when your prepaid hours are gone.
>
> Thanks!
>
> Higher Ground Learning

Until this ships, the current BL_BLOCK_CONFIRM draft/twin copy stays (it is truthful about today's behavior); do not publish copy E early.


## PL-324 — Tutors table: per-category expand (Scarlett, Aug 8)
The PL-320 grouped summary looks good, but clicking any category heading currently expands EVERYTHING. Make each heading expand independently: clicking "Math (11)" opens only the Math subjects beneath it; "Science (10)" only Science; etc. Multiple categories can be open at once; clicking again collapses that one. The subject filter's auto-expand/highlight opens only the matching category.


## PL-325 — View-as: allow read-only interactions (Scarlett, Aug 8, w/ screenshot)
The view-as preview blocks ALL clicks (pointer-events-none), which also kills harmless read-only ones — seen on the counselor view: the Performance report link, Copy link, the Class materials downloads (Flyer/Parent letter PDF+JPG), and the "Session calendar (4 sessions)" expander are all dead. Keep MUTATIONS blocked, but allow read-only interactions in view-as: expanders/collapsers, copy-to-clipboard, file downloads, and read-only links (the class report opens in a new tab, still stamped read-only/view-as). One rule for what counts as read-only, applied across all view-as roles.

## PL-326 — View-as Manager must render the real manager portal, not a description (Scarlett, Aug 8, w/ screenshot)
"View as → Manager" currently shows a summary card ("What a manager sees…") plus a sample pay surface — not the portal. Scarlett wants to SEE the portal as Kelsie sees it — concretely she wanted to check the manager's Settings → Notifications pane and could see nothing. Render the actual admin UI in manager-role view-as (same pages, ownership-level pieces hidden exactly as the real role hides them, incl. the manager's own Notifications pane with her grants), read-only per the view-as rule (PL-325 interactions allowed). The explanatory card can stay as a dismissible intro above the real view. Note: no manager profile exists yet in test data — view-as should render the manager role generically (or against Kelsie's row once created; PL-309 self-seeds her on first profile).


## PL-327 — Tutor email preferences (Scarlett, Aug 8 — supersedes the admin-only "Class emails" toggle where they overlap)
Tutors can control their INFORMATIONAL emails; OPERATIONAL ones stay mandatory.
- **Mandatory, never preference-able:** T5 timecard-ready-to-confirm (payroll), T3-T schedule change notices, SUB coverage request/outcome/hand-over.
- **Preference-able:** T6/T6-N session-notes reminders+nudges — options: on (today) / **weekly digest** / off; IN enrollment digests + milestone pings for their classes — same three options; IN FYI copies of family logistics emails — on/off. (Assignment welcome stays as a one-off.)
- **Who sets it:** tutors self-serve from their portal; the admin Instructors panel shows each tutor's choices and can override (same grant/self-toggle spirit as PL-309). The existing admin-only per-instructor "Class emails" toggle is ABSORBED into these preferences — no two switches that can disagree; migrate its current values as the starting state.
- **Defaults for existing + new tutors:** everything on (today's behavior), weekly-digest machinery sends on the existing weekly sweep cadence.
- Weekly digest content: one email rolling up what the individual reminders would have said (missing notes list / enrollment changes), plain English, deep links.


## PL-328 — Roster tab labels for no-school classes: "HGL"/"Online" prefixes (Scarlett, Aug 8, w/ screenshot)
School classes already abbreviate nicely ("ISD SAT Prep"). No-school classes currently render as "— PSAT Prep" and "— SAT Deep Dive: Mastering Advanced Math Concepts" (em-dash prefix + full name). Fix: **in-person-at-HGL → "HGL " + short name** ("HGL PSAT Prep"); **online → "Online " + short marketing name** ("Online SAT Math Deep Dive" — uses the class's short marketing name, falling back to full name if blank). Apply wherever the school-abbreviation labeling pattern renders (roster tabs, and check dashboards/pickers that use the same label source — keep it one source). NOTE (Scarlett earlier, PL-290 ship note): the no-"HGL"-prefix label rule was applied in the decision brief — that rule was about not double-prefixing admin email copy; this display rule is for the roster label surface. Code: reconcile the two so they don't fight (one labeling helper with a context flag if needed).


## PL-329 — Wizard Sessions step: bulk edit (Scarlett, Aug 8, w/ screenshot)
Real case: she made one session, cloned the rest week-by-week, then realized the TIME was wrong on all of them — today that's one edit per row. Add multi-select (checkboxes + select all) with a bulk-edit action applying to the selected rows: set start/end time, set location, and (nice-to-have) shift dates by N days. In the wizard this is pre-save UI state, so no email implications. If cheap, offer the same bulk time/location edit on the roster's sessions list — there it rides the PL-277/PL-314 update machinery, so ONE schedule-update email pair per family summarizing all changed sessions (the shared differ already composes multi-change lists), never one email per session.

---

# Ship notes (Aug 10, 2026 — all seven items)

## PL-323 ✅ SHIPPED (A–E, flow and copy together)
**A — auto-drop is the default.** The hourly sweep's new drop leg: an engagement in asked/declined whose effective block is exhausted walks its history exactly the way billing does (chronological, hours down from the block) and RELEASES every future, unbilled, still-scheduled session the block doesn't cover — Google event deleted, row deleted; past/billed rows never vanish. Idempotent via `block_dropped_at` (stamped first). The monthly generator now also materializes NOTHING for held engagements — the drop can't be quietly undone by the next cycle. Proven with fixtures: exactly the 2 uncovered future sessions dropped, the 2 covered past ones stayed, re-sweep drops nothing.
**B — continue is a choice.** The portal button is now "Continue tutoring" → a chooser: 5 · 10 · 15 more hours (each quoting its provenance rate) · until-I-cancel (monthly). Finite choices accumulate onto `block_continue_hours` and RE-ASK when the continuation itself nears its end (`block_ask_cycle` rides the dedupe key) — never perpetuity; monthly is perpetual only by explicit choice. The admin mirror records phone answers with the same choices (+5h/+10h/+15h/monthly/declined) and runs the same machinery.
**C — reservation with conflict handling.** On confirm, the portal reserves the continuing sessions with the SAME tutor, following the engagement's own recurrence, vetoed by the same checks the reschedule picker uses (portal session overlaps for tutor AND student + Google free/busy when connected), looking up to ~6 months out to cover the chosen amount. All clear → sessions insert confirmed at the new rate, Google events enqueue, the parent sees (and is emailed) the reserved times. ANY conflict, or a one-off engagement with no recurrence → routes to staff exactly like a reschedule request: `block_continue_staff_at` stamps, staff get an alert (reschedule-requests category), a dashboard to-do appears (self-resolves once staff schedule future sessions after the stamp), and the parent is told "our team will sort it out with you" — inline AND by email (NEW BL_CONTINUE_OUTCOME draft, twin sends meanwhile).
**D — rate correctness.** The decision re-rates the engagement: `hourly_rate` becomes the provenance-correct post-class rate (PL-322 sheet via studentTutoringTier; 5h/monthly → the 1–9h rate, 10/15 → the 10+ rate), recorded on `block_continue_rate` so later price-list edits never rewrite what the family agreed to. The ask email itself now quotes the provenance continuing rate — not the old block rate. `{tutoringHourlyRate}` still composes from the engagement.
**E — Scarlett's copy is LIVE-shaped.** BL_BLOCK_CONFIRM **v2** published (guarded full-body replace; template stays draft — the code twin now renders the SAME markdown through the comms-md pipeline, so her copy sends either way). NEW `{studentTutorName}` variable composes the tutor's name. Migrations 20260906000002/3 APPLIED. regress:package-overdraw re-proven at 17 checks under v2 semantics (ask quotes the provenance rate; monthly choice with no recurrence staff-routes; held overflow bills at the provenance continuing rate) + 4 new fixture-proven drop checks.

## PL-324 ✅ SHIPPED
Each category heading in the tutors table now toggles independently ("Math (11)" opens only Math; several at once; click-again collapses; "with prep" is its own toggle). An active subject filter force-opens ONLY the matching category and highlights its chip.

## PL-325 ✅ SHIPPED
The blanket pointer-events-none is gone. ONE rule (`view-as/read-only-preview.tsx`), applied across all view-as roles via a capture-phase interceptor: ALLOWED = expanders/collapsers (details/summary), copy-to-clipboard (CopyButton now carries `data-viewas-safe`), downloads, and read-only links (target=_blank, the class report, collateral/ICS/PDF endpoints) — those open in a NEW TAB stamped ?viewas=1 so the preview never navigates away. BLOCKED = everything else: buttons, form submits, in-page navigation. The counselor view's Performance report, Copy link, Flyer/Parent-letter downloads, and the Session calendar expander all work now.

## PL-326 ✅ SHIPPED
View as → Manager renders the REAL portal: an iframe of `/admin?viewas=manager`, where the admin page simulates the manager role — Contact settings / Team access / Price list show the role-true "admin-only — a manager sees nothing here" placeholder, the QBO and Google Calendar panels hide their admin-only controls the same way the real role does (callerRole override / simulatedManager prop), and the Notifications pane renders the manager variant (own rows, self-toggle chrome, no revoke buttons). The whole simulation wraps in the PL-325 interceptor (read-only) under a purple "Manager view simulation" strip. The explainer card survives as a dismissible intro (collapse to dismiss) above the real view, including the pay-titles-only sample. No manager profile exists yet, so the view renders the role generically — the intro says so, and PL-309 seeds Kelsie automatically when her profile appears.

## PL-327 ✅ SHIPPED
Three preferences on instructors (migration 20260906000004 APPLIED): session-note reminders (on / weekly digest / off), class digests + milestone pings (on = digest + instant pings / weekly = digest only / off = neither, and class calendar events stop — the same coupling the old toggle had), FYI copies (on/off). **Mandatory and untouched:** T5 timecard confirms, T3-T schedule changes, SUB coverage (verified none read the old switch). The "Class emails" toggle is ABSORBED: its values migrated as the starting state (19 disabled instructors → digests off + FYI off; the 1 enabled → all on), the switch is gone from the Instructors panel (replaced by a per-tutor prefs summary; editing lives in the profile editor with three controls), and the comms_enabled column was DROPPED post-deploy (20260906000005 APPLIED after the batch-33 build went live — a follow-up commit removed the four remaining reads/writes the drop exposed; prod verified healthy). Tutors self-serve from a new Email preferences card on their Teaching view (portal API actions, tutor-gated); staff can override in the editor — one set of switches, never two that disagree. NEW weekly rollup: `sweepWeeklyNotesDigest` on the Monday sweep sends 'weekly' tutors ONE plain-English email unioning the past week's still-missing notes with the deep link (T6_NOTES_WEEKLY draft + twin). Bonus rule cleanup: this panel's native confirm()/alert() calls (make-inactive, comms toggle) are gone — inline ConfirmAction + message banner.

## PL-328 ✅ SHIPPED
NEW `app/utils/class-label.ts` — ONE `classDisplayLabel()`: school → "ISD SAT Prep"; at-HGL → "HGL " + short marketing name (falls back to the full name → "HGL PSAT Prep"); online → "Online " + short marketing name ("Online SAT Math Deep Dive"). Wired: the roster tab strip, roster card header, class finder/search, follow-up class dropdown, collateral picker, clone-source labels, the assign-instructor confirm, the communications page's class labels + filter, and the public course-calendar page header (class-info re-exposes delivery_mode for it; school_id stays internal). **PL-290 reconciliation:** the helper carries an `internalEmail` flag that drops the "HGL " prefix (saying HGL to ourselves is noise) while keeping "Online " (real information) — the existing email-land label rule (lifecycle className + the two decision-brief sites) already behaves exactly that way and is untouched, so the two rules can't fight. Dashboard to-do texts already render bare names (never "—") per the same email-copy rule and were left as-is.

## PL-329 ✅ SHIPPED (wizard + roster)
**Wizard:** per-row checkboxes + select-all on the Sessions step with a bulk panel — set start/end time (TimeSelect), set location, shift dates by N days; blank fields keep each session's current value; pre-save state, no email implications.
**Roster:** "Edit every session at once…" on each roster card's session list → one time/location applied to ALL sessions via NEW `bulk_edit` on the class-session route. The server snapshots the list before, applies the update, diffs with the SHARED PL-314 differ, and sends exactly ONE schedule-update pair per informed family (registration-baseline families included) summarizing every changed session — never one email per session — then patches both baseline kinds so the sweep doesn't re-announce. Dedupe rides a hash of the change sentences.
