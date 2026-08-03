# Portal fixes — batch 26 (ALL 16 SHIPPED Aug 3 — PL-255 answered as the requested feasibility report, build on approval)

**Batch closed and handed off Aug 3, 2026.** Sixteen items: PL-254…269 — Scarlett's Aug 1 tutor-portal + counselor-email review, plus two findings from batch-25 verification (PL-268) and the PL-244 follow-up (PL-269).

**Shipped Aug 3 (same day).** Gate battery green: `tsc`, `npm run build`, smoke:public (8), regress:links, regress:pronouns (61), regress:mutation-buttons, regress:client-imports, cancel-class (11), resume-addon (13), tutoring-charge. Template versions published live: **CS_CLASS_CONFIRMED v5 · CS_COLLATERAL_FOLLOWUP v2 · CD_COUNSELOR_DIGEST v3 · AL_MISSING_DETAILS v3 · T5_TIMECARD_READY v3** (one script, `scripts/seed-pl264-265-269-copy.mjs`, anchor-guarded + idempotent, CS strip anchors enforced) — plus **T3_RESCHEDULE_ACK v1 seeded as a DRAFT** (new PL-262 template; its code twin sends identical copy until you ramp it). One migration, **applied**: `20260824000001_pl260_class_materials.sql`. One pre-existing bug found and flagged separately (not from this batch): the flyer's promo/deadline burst circle renders its text invisibly (white-on-white) — confirmed on prod too; a follow-up task chip was filed.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped · registry template edits ship as new versions with matching code twins (never drift) · verify composed blocks via the composer path, not editor samples · **inline confirm banners only — no native confirm()/alert()** (see PL-268).

---

## PL-254 — Tutoring page: side menu renders at the bottom of the page (reported Aug 1)

On /admin/tutoring the section side menu (Recent parent activity / Students / Billing / Timecards / Tutors) has moved to the bottom of the page instead of sitting as a sidebar. Restore the sidebar layout (likely a flex/grid regression).

✅ **Shipped Aug 3.** Not a flex/grid failure — the flex was fine; the SidebarLayout sat *below* two tall always-open sections (the wizard + Current Student Schedules), so the menu started ~1,100px down the page, which reads as "fell to the bottom". Fix: the sidebar now wraps the whole page — Scheduling (wizard + schedules) became the sixth section and the default landing, so the menu is a real top-left sidebar again. All deep links (?invoice / ?family / ?schedule) still land on their sections; ?schedule now also selects the Scheduling section. Verified in the browser: menu at top-left, section switching works.

## PL-255 — Staff login: passwords or Google SSO for employees (reported Aug 1 — needs a feasibility answer before build)

Magic-link-only sign-in is right for parents/students/counselors but annoying for HGL employees (admin, manager, tutors). Question to answer first: can staff accounts get passwords, or better, SSO through Google Workspace? If feasible, implement for admin/manager/tutor roles only — families and counselors stay email-only. Report the options + effort before building.

📋 **Answered Aug 3 — feasibility report as requested; NOTHING built, awaiting your pick.**

**Surprise finding: password sign-in already half-exists.** The login page has had a "Staff sign-in with password" toggle since Phase 4 — it calls Supabase's `signInWithPassword` and lands on /admin. What's missing is any way to *get* a password: accounts created by magic link have none, and there's no set/reset-password flow. So:

- **Option A — passwords (small):** add a "set/reset password" flow (Supabase `resetPasswordForEmail` + a small /auth/reset page), optionally gate the toggle to staff+instructor emails. Roughly half a day of code, no schema changes, no external setup. Downside: passwords to manage/forget, and offboarding means remembering to disable the account.
- **Option B — Google Workspace SSO (recommended, small-to-medium):** enable the Google provider in the Supabase dashboard, create an OAuth client in Google Cloud (an ops task for you/Billy, ~30 min), add a "Sign in with Google" button + an /auth/callback route, and a post-login guard that only accepts Google identities whose email is @highergroundlearning.com AND matches an existing staff/instructor record (anyone else gets signed out with a plain-English message). Roughly a day of code plus the dashboard/GCP setup. Upside: no passwords anywhere, and offboarding someone from Workspace kills their portal access automatically.
- **Either way, families and counselors are untouched** — magic-link stays the default for everyone; the staff paths are opt-in buttons on the same login page. Tutors are instructors records, so the same guard covers them.

Say the word on A, B, or both, and it goes in the next batch.

## PL-256 — Sign-in help copy: stop assuming everyone registered for a class (reported Aug 1 — exact strings)

The sign-in help text "Not receiving anything? Make sure you're using the exact email address you used when registering for a class. Parents sometimes register with an alternate or work email — the login email must match the one on the registration. Still stuck? Reply to any of our emails or write info@highergroundlearning.com and we'll sort it out." breaks for (a) employees and (b) parents/students doing 1-on-1 tutoring who never signed up for a class. Reword so it covers "the email address we have on file for you" (registration OR tutoring intake OR staff account) rather than class registration only. Also applies to the email footer line "sign in with just this email address" wherever context allows tailoring.

✅ **Shipped Aug 3.** The login help now reads: *"Make sure you're using the email address we have on file for you — the one on your class registration, your tutoring setup, or your staff account. Families sometimes sign up with an alternate or work email, and the login email must match the one we have."* (rest unchanged). The email footer line was audited and deliberately left alone: it's already role-agnostic ("parents, tutors, and school contacts all sign in with just their email") and stays true today — worth revisiting only if PL-255's SSO ships.

## PL-257 — Tutors must see (and be blocked by) the missing-session-notes state on their timecard (reported Aug 1)

The admin side correctly refuses to approve a timecard listing sessions missing notes — but the tutor side doesn't show this at all, and Scarlett WAS able to confirm a timecard as the tutor with notes still missing. Fix: (a) the tutor portal timecard shows the same plain-English list of sessions missing notes; (b) tutor "confirm timecard" fails closed until all notes are in; (c) a gentle recurring reminder each time they have unfilled notes (so they don't batch them at the deadline — T6/T6-N exist, make sure the in-portal state matches and nags appropriately).

✅ **Shipped Aug 3.** (a) The tutor's timecard panel now shows an amber banner listing exactly which sessions are missing notes (date + student), fed by the same completed-sessions-minus-notes check the admin gate runs. (b) Fails closed twice: the Confirm button is disabled while anything is missing, and the API re-runs the admin's anti-join server-side and 400s with the same plain-English list — the exact "Scarlett confirmed with notes missing" hole. Verified end-to-end with a QA fixture: open card + note-less completed session → banner shown, confirm blocked (UI and API); note added → confirm succeeded; fixture fully reverted. (c) The recurring nag already exists and now matches the portal state: T6 end-of-day emails fire once per day-with-missing-notes (so every new unfilled day re-nags), the T6-N nudge follows at +3 days, and the in-portal banner is now the always-on visual. No cadence change needed — documented here so it's deliberate.

## PL-258 — Tutor "My Students" renders the PARENT view incl. billing — role separation bug (reported Aug 1)

In tutor view, the "My Students" tab renders the parent view with classes, billing, and payments. Tutors must NEVER see what parents pay. Investigate whether this is billy@ holding many roles (parent + instructor + tutor) crossing wires — that stack would never happen in reality, but the portal must prevent/handle multi-role accounts cleanly rather than bleeding views. Then build the real tutor "My Students": student + parent contact info, schedules, subjects, session history/notes — **no finances anywhere**.

✅ **Shipped Aug 3 — investigation first, and good news: no data ever leaked.** The "My Students" pill was the **parent** tab's label — billy@ is genuinely a parent in the test data, and clicking it showed *his own family's* RLS-scoped billing, never other parents'. A labeling trap, not a privilege bleed. Fixes: the parent pill is now **"My family"** (unambiguous on multi-role accounts; parents-only users never see pills at all), and the real tutor **"My students" panel** now lives in the Teaching view: one card per tutored student with parent name + email, subjects, weekly schedule from the engagement, next session, and the last three session notes. Deliberately *not* selected anywhere on that surface: rates, funding, invoices, payment status — the query can't even return them. Reads run service-role scoped hard to the tutor's id (the established coverage-panel pattern; families carry no tutor RLS policy, which is correct).

## PL-259 — Unite ?view=instructor and ?view=tutor into one instructor view (reported Aug 1)

"My classes" renders /portal?view=instructor while "My tutoring" goes to /portal?view=tutor. Tutor = instructor — same people. Merge under **view=instructor**: render a "My classes" section if they teach any classes and a "My tutoring" section if they do any 1-on-1 tutoring (either alone, or both).

✅ **Shipped Aug 3.** One **"Teaching"** pill now covers both: view=instructor renders a "My classes" section (when they teach classes) and a "My tutoring" section (when they tutor), either alone or both. `?view=tutor` stays a working alias — T5/T6/coverage emails in the wild link it, and it now lands on the merged view. Verified in the browser as billy@ (teaches + tutors + parent): pills are "Teaching · My family", both sections render, alias works.

## PL-260 — Instructors can leave materials for an entire class (reported Aug 1)

From the merged instructor view (PL-259), an instructor should be able to post/upload materials visible to the whole class (students/parents of that class), the way they presumably can per-student in tutoring.

✅ **Shipped Aug 3.** The Share-materials panel's target picker now offers **"Whole class (everyone)"** alongside individual students — one share reaches every enrolled family, labeled "for the whole class" in their portals. Under the hood the per-student machinery (PL-203) learned a class target: `student_materials.class_id` (migration `20260824000001`, **applied** — exactly one of student/class per row, RLS mirrors the API), the materials API accepts classId on list/share (instructor-owns-class checked), files store under `class/{id}/` in the same private bucket with signed URLs, and the parent list includes class items for their students' enrollments. Verified end-to-end: staff-shared a class-wide link to the ISD class → the enrolled QA parent's own session listed it (parent branch, not staff) → deleted → gone. Bonus PL-268 compliance: the panel's remove button had a native confirm(); it's an inline arm-confirm now.

## PL-261 — Remove "ran shorter/longer" from tutor timecards — sessions are fixed at scheduled length (reported Aug 1)

Drop the ran-shorter/ran-longer adjustment from the tutor portal timecards section. Scheduled 60 minutes = parents charged 60 = tutor paid 60. Variable actuals create billing/payroll mismatch risk. Remove the UI and make the pipeline use scheduled duration.

✅ **Shipped Aug 3.** The "ran shorter/longer…" control and its `adjust_duration` API action are gone. How the pipeline works: there was never a separate "actual" column — the adjustment **rewrote the session's end time in place**, and since `duration_minutes` is generated from start/end, every consumer (family invoice lines, package draw-down, tutor pay, payroll CSV) silently switched to the actual. With nothing rewriting `ends_at` after the fact, scheduled duration IS what bills and pays, everywhere, with no pipeline changes needed. The T5 timecard email no longer mentions "a session that ran a different length" (**T5_TIMECARD_READY v3 live** + code twin + seed). Note: the admin's own duration editor in the tutoring schedule view was deliberately left — the Ops Director can still correct a genuinely wrong schedule; what's gone is the tutor-side after-the-fact adjustment.

## PL-262 — Reschedule-request admin emails need actions (reported Aug 1, from the two [Reschedule request — Roman Thomas Sierra] sends)

The admin notification ("family asked to move the French session… Use Reschedule on the session in /admin/tutoring") describes what to do but offers no way to do it. Add action links: (a) acknowledge — send the parent a "got your message" reply; (b) deep-link straight to that session's Reschedule flow in /admin/tutoring (not just the page); admin can then make changes beyond what the family could do themselves. Keep the inside-24h/$40-policy vs free-24h+ distinction visible in the flow.

✅ **Shipped Aug 3.** The alert now acts: a **"Reschedule this session"** button deep-links `/admin/tutoring?session={id}&reschedule=1` — the page lands on Scheduling, jumps to the session's tutor + week, and opens its dialog straight into the Reschedule form. An **"Acknowledge — email the family"** link (`&ack=1`) opens the same dialog with a pre-armed Acknowledge confirm — one deliberate click sends the parent a "got your message, we're on it" email (never a state change straight off an email GET — the bot-safety rule). That ack is the new **T3_RESCHEDULE_ACK** (seeded as a draft for your review; the code twin sends identical copy meanwhile), includes the $40/inside-24h caveat only when it applies, and dedupes per request — double-clicks can't double-send, while a NEW request on the same session can be acknowledged again. The Acknowledge button also lives permanently on the session's pending-request banner. The 24h/$40 vs free distinction stays in the alert subject + body and throughout the reschedule flow. Verified live: deep link opened the right dialog pre-armed, ack sent and recorded (`t3_resched_ack:{session}:{requestStamp}`), delivered.

## PL-263 — Late class setup: accelerate the counselor classroom-request emails instead of skipping them (reported Aug 1)

When a class is created late (inside the normal CR1 → CR2 → CR3 lead times), those sends currently just skip. They should compress/accelerate: send what still makes sense immediately and shorten the gaps, so we always actually ask for the classroom.

✅ **Shipped Aug 3 — with a premise correction.** Late-created classes were NOT skipped: CR1 already fired on the first sweep inside the window, and the absolute −11/−8-day nudge thresholds being already past meant CR2 and CR3 fired on the *next two hourly sweeps* — three asks in three hours, the opposite failure. (True never-send cases remain only: class created after its first session, no counselor on the school, or an online class — correct by design.) The fix makes compression deliberate: each nudge is due at the LATER of its normal absolute day and "CR1 + a gap scaled to the remaining runway" (runway/3, clamped 1–3 days). Normal classes are byte-identical (−14/−11/−8); a class created 6 days out asks day 0 / +2 / +4; created 2 days out asks day 0 / +1 / +2. Verified live with a QA class 2 days out: CR1 sent on the first sweep, and an immediate second sweep correctly held CR2 (old code would have fired it). Fixture fully cleaned up.

## PL-264 — [HGL Admin] Missing details email: overdue-aware wording (reported Aug 1 — related to PL-263)

Two symptoms from a late-created class: (a) "Location — blank. Classroom request status: asked the counselor not yet sent · nudged not yet sent · last call not yet sent." — we have no classroom AND never asked; once PL-263 exists this should rarely happen, but the status line should flag "never asked — class was created late" rather than reading like a plan on track. (b) "The \"class details\" email to families goes out Saturday, August 1, 2026 (1 day ago)" — future tense for a past-due date. When the scheduled date is in the past, say it's overdue: e.g. "should have gone out Saturday, August 1, 2026 (2 days ago) — it is now overdue" (plain English, Code's phrasing fine).

✅ **Shipped Aug 3.** (a) When the class sits inside the request window with CR1 never sent (in-person only), the status line now says: *"never asked — the class was created inside the request window (the accelerated ask goes out on the next sweep)"* — instead of the three on-track-looking "not yet sent"s. (b) Past the send date, the body reads *"should have gone out {date} (N days ago) — **it is now overdue**, held because these are blank"*, with the closing paragraph switched to "families are waiting on it". The SUBJECT is tense-aware too via the new `{classDetailsSendPhrase}` variable — **AL_MISSING_DETAILS v3 live**: "…class-details email goes out {date}" before the date, "…class-details email is OVERDUE" after. Verified live with the PL-263 fixture: the delivered alert's subject read "…is overdue", and the earlier 6-days-out variant rendered "goes out Wednesday, August 5, 2026" through the same variable.

## PL-265 — CD counselor enrollment digest copy edits (reported Aug 1, from "ISD enrollment update — 2 students enrolled" — exact strings)

1. Singular/plural: "Here's where enrollment stands for the upcoming Higher Ground Learning classes at International School of Dusseldorf" must agree with the actual count (one class → "class"). Pluralize dynamically.
2. "Class materials (flyer for bulletin boards & screens, parent letter to forward) are in [your portal](…) — always current, so re-download rather than reusing saved copies." becomes:
   > "Current class materials (flyer for bulletin boards & screens, parent letter to forward) are always available in [your portal](…)."
3. Delete: "See live counts and scores any time — sign in at https://hgl-portal.vercel.app/portal with this email."
4. "Know a student who's still on the fence? Forwarding them (or their parents) the registration link is the single most helpful thing you can do — everything after the click is automatic." becomes:
   > "If you know a student who's still on the fence, forwarding them (or their parents) the registration link is the single most helpful thing you can do."
5. Delete: "Questions about any student or class? Just reply to this email."
(New version via anchor-guard + code twin as applicable.)

✅ **Shipped Aug 3 — CD_COUNSELOR_DIGEST v3 live, all five edits.** (1) The stored body now says "the upcoming Higher Ground Learning {digestClassNoun} at {schoolName}" — a new variable the digest sweep fills with "class"/"classes" from the real count (the code twin was already dynamic; the stored body had hardcoded "classes"). (2) The materials sentence turned out to live in the composed {digestClassListBlock}, not the stored body — reworded at the composer to your exact copy, so it reaches sends with no version dependency. (3) portal-signin line deleted. (4) fence-sitter line softened to your exact copy. (5) "Questions about any student or class?" deleted. Stored body + code twin + seed mirror all in lockstep; publish was anchor-guarded and idempotent.

## PL-266 — Expired promos must drop out of the downloadable flyer (reported Aug 1)

"Always current" has to include promotions: if the $50-off promo runs through 7/31, the flyer downloaded on 8/1 (from the counselor portal or anywhere) must render WITHOUT the promo burst. Generator should check promo validity at render time.

✅ **Shipped Aug 3.** The gate lives in the collateral MODEL (`loadCollateralModel`): a promo whose deadline has passed — school-local calendar date, valid through the deadline day — renders as if it never existed, so every artifact (flyer, letter, any format/language) drops it in one place. Verified: with an expired QA promo the model returns promo=null and the flyer renders without it; flipped to a valid deadline the model carries the promo again (the deadline-fallback burst takes its place when a promo lapses). **Separate pre-existing bug found while verifying, NOT from this change:** the flyer's burst circle renders its text invisibly (white text over the transparent-interior brush ring) — on prod today too, so promo bursts have likely never been legible on the generated flyer. Filed as its own follow-up task chip rather than folded in here, since it's a design-sensitive fix you'll want to eyeball.

## PL-267 — [HGL Admin] Admin roster report copy (reported Aug 1 — exact strings)

"Open classes — full rosters" becomes "Enrollment for open classes". Delete "(travel booking waits on these)".

✅ **Shipped Aug 3.** Both strings changed in the roster-report composer (the AL_ROSTER_REPORT registry body is just the composed block, so no version bump needed) and the editor preview fixture kept in sync.

## PL-268 — Replace native confirm()/alert() with inline confirm banners in app/admin/page.tsx (found Aug 1 during batch-25 verification)

The roster instructor dropdown's confirm (`handleAssignInstructor`) is a native confirm() — it violates the inline-confirm standing rule and freezes the browser automation bridge (froze the Aug 1 verification session). Neighbors in the same file are also native (convert-to-tutoring, remove-session, re-offer spot, cancellation handlers, alert() error surfaces). Convert to the inline ConfirmAction pattern the calendar's assign button already uses; errors become inline banners.

✅ **Shipped Aug 3 — zero native confirm()/alert() left in app/admin/page.tsx.** Converted: instructor dropdown (change parks in an inline banner under the row, the select snaps back until confirmed), notify-waiting-families, mark-refunded, convert-to-tutoring (full consequence copy in the arm message), re-offer-the-spot, remove-session — all ConfirmAction; the waitlist over-cap override (previously a NESTED native confirm) asks in an inline banner carrying the logged-override warning. All ~18 alert() outcome/error surfaces now land in one dismissible bottom-right banner; the add-session form reuses its own inline error line. Two prompt() sites remain by scope (slug + close-date + add-back position want typed input, not yes/no) — flagged as follow-up debt in-code; they don't chain-freeze automation the way confirm() did. Verified in the browser with NO confirm stub — the automation bridge no longer freezes (that was the test), banners arm/cancel cleanly.

## PL-269 — CS counselor emails: "Best," → "Thanks!" (confirmed by Scarlett Aug 3 — the PL-244 follow-up)

The "Best," signoff in the CS counselor emails (CS_CLASS_CONFIRMED and CS_COLLATERAL_FOLLOWUP bodies — the ones PL-244 deliberately left alone) becomes "Thanks!", matching the letter's new valediction. New versions via anchor-guard; the PL-237 no-collateral strip anchors must still survive in CS_CLASS_CONFIRMED (the publish script enforces this).

✅ **Shipped Aug 3 — CS_CLASS_CONFIRMED v5 + CS_COLLATERAL_FOLLOWUP v2 live.** Both signoffs are "Thanks!" now, matching the letter. The publish script re-asserted all three PL-237 strip anchors survive in the v5 body before publishing (fail-closed no-collateral send unaffected); seed mirror synced; idempotent second run confirmed no-op. The CX cancellation email's "Best," was deliberately left alone — this item names the CS pair only.
