# Portal fixes — batch 3 (July 20, 2026)

> **Status (July 20, Code):** all three items implemented, committed, and **pushed**; migrations
> 20260722000001–2 **applied**. E0_CONFIRM_PARENT v2 (conditional tutoring paragraph) is live in
> the registry; E8_ADDON_SCHEDULING / E8_ADDON_NUDGE seeded as drafts (code twins send until
> flipped live). Reggie's missing add-on row deliberately left (purged at cutover).

Third punch-list cycle, from live payment-path testing. Continues PL-x numbering (batch 1: `portal-fixes-2026-07-17.md`, batch 2: `portal-fixes-2026-07-19.md`, both fully shipped). Three items, all decided by Scarlett — no open questions. More findings are coming; this batch is released now so work can start.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · human-help contact block on parent surfaces · **`git push` after committing** (AGENTS.md) · PL-x IDs in commit messages · check items off here when shipped.

**Live QA context (don't "fix"):** Reggie QAStudent is now a PAID ISD enrollment (test card, July 17, $899 — deliberately exercised the resume-payment path; that's how PL-52 was found). His PR2–4 rows should be cancelled/skipped by the paid-status filter — verify while in there. All QA rows die in the PL-48 purge at cutover.

---

## PL-51 (decided: option a) · Time-sensitive emails must not wait for the daily cron
**Found:** PR1 ("~2h after registration") never sent for an afternoon registration — the reminder queue is only materialized/sent by the daily cron (`vercel.json`: `0 14 * * *`, the only schedule the Vercel free tier allows). Anything scheduled after that day's tick waits until the next morning; PR1's 2h promise only holds for morning registrations, and PR2's +24h spacing collapses into the same batch.
**Fix (Scarlett chose option a):** the registration handler and the payment webhook run an inline "send anything due for this enrollment" mini-pass at the end of their own request (create the projected PR rows immediately at registration, and send any already-due rows). The daily cron stays as the batch backstop for 8 AM sequence sends, nudges, and sweeps. Keep the pass narrow (this enrollment only) and fast (fire-and-forget after the response, same pattern as the existing after() usage — mind the floating-promise bugs fixed in 7c).
**Note:** a future Vercel Pro upgrade (hourly crons) narrows worst-case lag for everything else but changes nothing here — this fix is correct under both plans.
✅ **Done and verified** — `runEnrollmentCommsPass` runs behind the registration response and the payment webhook: materializes this enrollment's projected rows immediately (verified live: all four PR rows exist seconds after registration with the right +2/+24/+72/+144h offsets, so the Upcoming tab is real from minute one and "Send now" works) and sends anything already due. State-driven like the sweep — rows the current projection no longer contains are audit-cancelled and can never send from the pass (e.g. PR reminders after the very payment that triggered it). Daily cron unchanged as backstop.

## PL-52 (confirmed bug, pre-launch) · Resume-payment silently drops the selected tutoring add-on
**Repro (live, July 17):** registration filled for Reggie QAStudent on ISD → add-on step → selected the 5-hour/$600 package → redirected to Stripe checkout → session abandoned → later paid via PR1's resume-payment link → charged **$899 (class only)**; `enrollment_addons` has zero rows; the #0 order summary shows no add-on line. The parent's selection evaporated with the abandoned Stripe session.
**Why it matters:** a real family that picks an add-on, gets interrupted, and pays from a reminder loses their tutoring hours silently — lost revenue, mismatched expectations, and they then get the #9 upsell for something they already chose.
**Fix:** persist the add-on selection on the enrollment (or a durable pending-selection record) at the moment it's chosen — not only in the Stripe session — and have `/api/resume-payment` rebuild the checkout with the same line items. Add a guard: if a resumed session's total differs from what the parent originally built, alert rather than silently charging less. Regression test: register + add-on → abandon → resume → pay → assert add-on row exists and totals match.
**Cleanup:** decide whether to hand-fix Reggie's missing add-on row for QA continuity or leave it (he's purged at cutover either way). Also verify his queued PR2–4 got cancelled by the paid filter, and note that #9 firing for him is a symptom of this bug, not a suppression failure.
✅ **Done and regression-proven** — the selection persists on the enrollment (`pending_package_id` + `pending_checkout_total`, migration 20260722000001) at checkout creation; resume-payment rebuilds the identical cart and metadata, alerts on a retired package (proceeds class-only, never a silent drop or charge) and on any total mismatch. Webhook clears the marker on paid. `scripts/regress-resume-addon.mjs` (register + add-on → abandon → resume → synthetic signed payment; self-cleaning, test-mode-guarded): **13/13 pass**, resumed session carried both line items at $1,499.
**Cleanup decisions:** Reggie's add-on row left missing (purged at cutover). His PR2–4 sat `scheduled` only because the daily cron hadn't ticked since payment — the sweep's Pending filter never sends them, reconciliation cancels them next run, and the PL-51 pass now cancels this case at payment time. #9 firing for him was a symptom of the missing addon row, as suspected.

## PL-53 (decided + copy approved) · Add-on hours lifecycle: #0 copy, early availability, post-class scheduling, instructor handoff

Four connected pieces; Scarlett approved all decisions and the copy below verbatim.

### a. #0 confirmation — conditional, rewritten paragraph
The "Did you register for 1-on-1 tutoring?" paragraph renders **only when the enrollment has an add-on** (never for class-only), replacing the legacy MailerLite-era text, alongside the recap line item the #0 spec already calls for. Approved copy (register in the template registry like everything else):

> **Your 1-on-1 tutoring hours.** Your registration includes {addonHours} hours of 1-on-1 tutoring. In our experience they're most valuable *after* the class ends — that's when a tutor can zero in on exactly what your student needs next. When the class wraps up, we'll reach out to get {studentFirstName} scheduled. Want to start earlier instead? [Share your availability]({availabilityLink}) and we'll propose times. Not sure yet? No problem — we'll ask again once the class is done.

Affordance: **inline link, not a button** — the copy does the de-urgenting; the reassurance line is deliberate.
✅ **Done** — the paragraph renders ONLY for add-on enrollments (verified: empty string for class-only; approved copy verbatim with the inline link for add-ons), shared one-source between the code render (`addonTutoringBlockHtml`) and the registry's `{addonTutoringBlock}` variable. **E0_CONFIRM_PARENT v2 published live** replacing the MailerLite-era text.

### b. Tokenized availability page for add-on families
`{availabilityLink}` → a family-scoped signed-token page (same HMAC pattern as schedule-confirm/autopay) rendering the **same availability grid component** used on intake and in the wizard. Submit → rows land in `student_availability` (`source='intake'` or a new `'parent'` value — Code's call, keep it queryable) → Ops Director alerted ("add-on family shared availability — ready to schedule"). From there the student flows through the standard pipeline: wizard suggestions → PL-41 approval → welcome email. **One pipeline for every 1-on-1 student, whether they came via class add-on or direct intake.** Token is reusable/idempotent (re-submitting updates rows, shows the friendly already-done state with an edit option).
✅ **Done and E2E-verified** — `/availability/{token}` (family HMAC, same pattern), one grid per student (the shared component), already-done state with editing, contact block. Submit → rows land with `source='parent'` (constraint extended, migration 20260722000002) → Ops alert delivered ("Add-on family shared availability — Fakey McFakerson is ready to schedule"). From there it's the standard pipeline: wizard suggestions → PL-41 approval → welcome. One pipeline for every 1-on-1 student.

### c. Post-class scheduling — fork #8, don't add a new email
#8 (+4 days after final session) becomes audience-aware:
- **Family has NO add-on hours** → existing #8 discount offer, unchanged.
- **Family HAS unused add-on hours** → a "time to put your hours to work" version instead (a sales pitch to someone who already bought is wrong — latent bug in current #8): hours remaining, the availability link — or, if availability is already on file, "we're ready to propose times." Warm tone, sent from the configured tutoring contact (PL-50). Register as its own template key (e.g. `E8_ADDON_SCHEDULING`) so both forks are editable.
- **Suppression:** the scheduling fork does NOT send if the family already shared availability AND has 1-on-1 sessions scheduled or completed (early starters are never nagged). One gentle nudge ~7 days later if still no availability/schedule; then an Ops Director alert so Kelsie calls. Never auto-escalates beyond that.
✅ **Done** — the #8 sweep is audience-aware: add-on families get `E8_ADDON_SCHEDULING` (hours remaining + availability link, or "we're ready to propose times" when on file; parent-only, From the PL-50 contact) instead of the discount pitch; the availability-shared-AND-scheduled case cancels the projected row with an audit reason. Nudge at +7 days (`E8_ADDON_NUDGE`, once), Ops alert at +14 (once), nothing further. Both templates registered as drafts (editable; code twins send until flipped live).

### d. Instructor continuation visibility + handoff notes
- Roster marker (instructor view + admin) on students continuing to 1-on-1 tutoring (add-on hours present, or a tutoring schedule already exists).
- Prompt attached to the **final session's attendance screen** (where the instructor already is): "Reggie continues with 1-on-1 tutoring — leave a handoff note: what you covered, where they're strong, what to work on next." Also surfaced in the instructor view after the class ends until written.
- The note lands on the student's tutoring record: visible to Kelsie during matching and to the assigned tutor before the first session. Purpose: the 1-on-1 continues from where class ended — the student never re-hears the class material.
- Wizard matching hint: when the class instructor also tutors the relevant subject, surface them prominently ("{name} taught Reggie's class") — a hint, never a rule (continuity preferred, Ops Director's judgment wins).
✅ **Done** — "continues to 1-on-1" roster badges on the instructor view and admin roster (add-on present or live schedule); handoff-note panel on the instructor's attendance screen from the final session day onward (and until written), saved via an instructor/staff-gated API into `students.tutoring_handoff_note` (+ by/at, migration 20260722000002); the note shows in the wizard while matching ("Handoff from {instructor}: …"); the continuity hint floats the class instructor up within their tier, tags their option " — taught their class", and explains itself — a hint, never a rule. The assigned tutor sees it in THEIR portal view above their upcoming sessions (instructor_student_ids extended so tutors can read their own 1-on-1 students — migration 20260722000003, applied; this also fixes the latent gap where a tutor's session list lost student names for students who never took their class).

---

## Suggested order
1. PL-52 first (pre-launch, revenue-touching) with its regression test.
2. PL-51 (small, contained, makes all payment-flow QA snappier).
3. PL-53 a→b→c→d (b enables a's link; c depends on b; d is independent UI).

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-20.md` (batch 3 — three items, all decided, copy approved inline).
>
> Build in order: (1) PL-52 — persist add-on selections and rebuild resume-payment checkouts with the same line items, plus the totals guard and the register→abandon→resume regression test; (2) PL-51 option (a) — inline send-due pass in the registration handler and payment webhook, daily cron unchanged as backstop; (3) PL-53 — the conditional #0 tutoring paragraph (approved copy verbatim, inline link), the tokenized family availability page feeding `student_availability` + Ops alert, the audience-aware #8 fork with its suppression rules and one-nudge-then-alert, and the instructor continuation marker + final-session handoff-note prompt feeding the student's tutoring record and the wizard's continuity hint.
>
> Rules: PL-x IDs in commit messages; `git push` after committing; new emails register in the template registry (editable, sent from the PL-50 configured contact where specified); standing copy rules apply; don't touch QA data except as PL-52's cleanup note describes; check items off in this doc as you ship. If DB writes are blocked this session, leave idempotent migrations and say so at handoff.
