# Portal fixes — batch 3 (July 20, 2026)

Third punch-list cycle, from live payment-path testing. Continues PL-x numbering (batch 1: `portal-fixes-2026-07-17.md`, batch 2: `portal-fixes-2026-07-19.md`, both fully shipped). Three items, all decided by Scarlett — no open questions. More findings are coming; this batch is released now so work can start.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · human-help contact block on parent surfaces · **`git push` after committing** (AGENTS.md) · PL-x IDs in commit messages · check items off here when shipped.

**Live QA context (don't "fix"):** Reggie QAStudent is now a PAID ISD enrollment (test card, July 17, $899 — deliberately exercised the resume-payment path; that's how PL-52 was found). His PR2–4 rows should be cancelled/skipped by the paid-status filter — verify while in there. All QA rows die in the PL-48 purge at cutover.

---

## PL-51 (decided: option a) · Time-sensitive emails must not wait for the daily cron
**Found:** PR1 ("~2h after registration") never sent for an afternoon registration — the reminder queue is only materialized/sent by the daily cron (`vercel.json`: `0 14 * * *`, the only schedule the Vercel free tier allows). Anything scheduled after that day's tick waits until the next morning; PR1's 2h promise only holds for morning registrations, and PR2's +24h spacing collapses into the same batch.
**Fix (Scarlett chose option a):** the registration handler and the payment webhook run an inline "send anything due for this enrollment" mini-pass at the end of their own request (create the projected PR rows immediately at registration, and send any already-due rows). The daily cron stays as the batch backstop for 8 AM sequence sends, nudges, and sweeps. Keep the pass narrow (this enrollment only) and fast (fire-and-forget after the response, same pattern as the existing after() usage — mind the floating-promise bugs fixed in 7c).
**Note:** a future Vercel Pro upgrade (hourly crons) narrows worst-case lag for everything else but changes nothing here — this fix is correct under both plans.

## PL-52 (confirmed bug, pre-launch) · Resume-payment silently drops the selected tutoring add-on
**Repro (live, July 17):** registration filled for Reggie QAStudent on ISD → add-on step → selected the 5-hour/$600 package → redirected to Stripe checkout → session abandoned → later paid via PR1's resume-payment link → charged **$899 (class only)**; `enrollment_addons` has zero rows; the #0 order summary shows no add-on line. The parent's selection evaporated with the abandoned Stripe session.
**Why it matters:** a real family that picks an add-on, gets interrupted, and pays from a reminder loses their tutoring hours silently — lost revenue, mismatched expectations, and they then get the #9 upsell for something they already chose.
**Fix:** persist the add-on selection on the enrollment (or a durable pending-selection record) at the moment it's chosen — not only in the Stripe session — and have `/api/resume-payment` rebuild the checkout with the same line items. Add a guard: if a resumed session's total differs from what the parent originally built, alert rather than silently charging less. Regression test: register + add-on → abandon → resume → pay → assert add-on row exists and totals match.
**Cleanup:** decide whether to hand-fix Reggie's missing add-on row for QA continuity or leave it (he's purged at cutover either way). Also verify his queued PR2–4 got cancelled by the paid filter, and note that #9 firing for him is a symptom of this bug, not a suppression failure.

## PL-53 (decided + copy approved) · Add-on hours lifecycle: #0 copy, early availability, post-class scheduling, instructor handoff

Four connected pieces; Scarlett approved all decisions and the copy below verbatim.

### a. #0 confirmation — conditional, rewritten paragraph
The "Did you register for 1-on-1 tutoring?" paragraph renders **only when the enrollment has an add-on** (never for class-only), replacing the legacy MailerLite-era text, alongside the recap line item the #0 spec already calls for. Approved copy (register in the template registry like everything else):

> **Your 1-on-1 tutoring hours.** Your registration includes {addonHours} hours of 1-on-1 tutoring. In our experience they're most valuable *after* the class ends — that's when a tutor can zero in on exactly what your student needs next. When the class wraps up, we'll reach out to get {studentFirstName} scheduled. Want to start earlier instead? [Share your availability]({availabilityLink}) and we'll propose times. Not sure yet? No problem — we'll ask again once the class is done.

Affordance: **inline link, not a button** — the copy does the de-urgenting; the reassurance line is deliberate.

### b. Tokenized availability page for add-on families
`{availabilityLink}` → a family-scoped signed-token page (same HMAC pattern as schedule-confirm/autopay) rendering the **same availability grid component** used on intake and in the wizard. Submit → rows land in `student_availability` (`source='intake'` or a new `'parent'` value — Code's call, keep it queryable) → Ops Director alerted ("add-on family shared availability — ready to schedule"). From there the student flows through the standard pipeline: wizard suggestions → PL-41 approval → welcome email. **One pipeline for every 1-on-1 student, whether they came via class add-on or direct intake.** Token is reusable/idempotent (re-submitting updates rows, shows the friendly already-done state with an edit option).

### c. Post-class scheduling — fork #8, don't add a new email
#8 (+4 days after final session) becomes audience-aware:
- **Family has NO add-on hours** → existing #8 discount offer, unchanged.
- **Family HAS unused add-on hours** → a "time to put your hours to work" version instead (a sales pitch to someone who already bought is wrong — latent bug in current #8): hours remaining, the availability link — or, if availability is already on file, "we're ready to propose times." Warm tone, sent from the configured tutoring contact (PL-50). Register as its own template key (e.g. `E8_ADDON_SCHEDULING`) so both forks are editable.
- **Suppression:** the scheduling fork does NOT send if the family already shared availability AND has 1-on-1 sessions scheduled or completed (early starters are never nagged). One gentle nudge ~7 days later if still no availability/schedule; then an Ops Director alert so Kelsie calls. Never auto-escalates beyond that.

### d. Instructor continuation visibility + handoff notes
- Roster marker (instructor view + admin) on students continuing to 1-on-1 tutoring (add-on hours present, or a tutoring schedule already exists).
- Prompt attached to the **final session's attendance screen** (where the instructor already is): "Reggie continues with 1-on-1 tutoring — leave a handoff note: what you covered, where they're strong, what to work on next." Also surfaced in the instructor view after the class ends until written.
- The note lands on the student's tutoring record: visible to Kelsie during matching and to the assigned tutor before the first session. Purpose: the 1-on-1 continues from where class ended — the student never re-hears the class material.
- Wizard matching hint: when the class instructor also tutors the relevant subject, surface them prominently ("{name} taught Reggie's class") — a hint, never a rule (continuity preferred, Ops Director's judgment wins).

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
