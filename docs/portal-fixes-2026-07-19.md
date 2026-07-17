# Portal fixes — batch 2 (July 19, 2026)

Second punch-list cycle, from Scarlett's continued testing plus operational planning for the migration to real data. Continues the PL-x numbering from `docs/portal-fixes-2026-07-17.md` (batch 1, PL-1…PL-33, all shipped/withdrawn). Companion specs: `docs/AVAILABILITY_MATCHING_SPEC.md` (PL-19, shipped) and `docs/SESSION_SETUP_COMMS_SPEC.md` (PL-40/41 — the parent approval + welcome-email flow, **read before building those two**). Tutor/subject seed data: `docs/TUTOR_ROSTER_SEED.md`.

**Standing rules (unchanged, apply to everything below):** UI never says "engagement" (student-centric copy); "Ops Director" not "OM"; plain-English statuses; human-help contact block on parent surfaces; **always `git push` after committing** (see AGENTS.md — batch 1 was verified against stale prod because commits sat unpushed).

**Known/intentional — do not "fix":** remaining QA fixtures in prod (see PL-48, which removes them all); Stripe test mode + QBO sandbox until cutover; T1–T8 not yet in the template registry (PL-13 batches with that pass); time-based 7c billing edges ride the Aug 20 run.

---

## A. Pre-launch / data-integrity

### PL-15 (REOPENED — revert) · Collateral must print the enrollment deadline, not the registration close date
Batch 1 changed the flyer/letter to print `registration_close_date`. That was wrong — reverting per Scarlett. **Rationale (worth encoding as a comment):** in-person classes are often taught on-site far away (Cape Town, Cairo…), so HGL sets an early *enrollment deadline* — the "we must know by now to arrange instructor travel" date — typically 5–6 weeks before start, while true registration can close much later (and online classes can close close to the start). The collateral's urgency date is deliberately the early enrollment deadline.
- **Fix:** collateral prints `classes.enrollment_deadline` (the field from master spec §3), falling back to `registration_close_date` only when the deadline is unset. Add helper text in the admin collateral card: "The flyer prints the enrollment deadline (your commit-by date), not the registration close date."
- **Related enhancement:** at class creation, default `enrollment_deadline` to start − ~5–6 weeks for in-person classes; leave it near/blank for online. Editable either way.

### PL-48 · QA-data purge script (runs before real data, part of the cutover runbook)
An idempotent, dry-run-first script that removes every QA fixture so the first real import starts clean. Must delete in FK-safe order and cover: the QA classes + their enrollments (incl. Reggie QAStudent, Scar Tissue, Roman Desmond, Bill Thom), the tutoring engagement (Roman × SAT × Billy) + September invoice + sessions + timecards, the "Faker Fakerson × ASVAB" package fixture, the QA leads/agreements (Roman Thomas Sierra lead, QA Availability, QA Intake2), the availability rows from those tests, and all scheduled/sent `email_sends` for the above. Careful with Stripe test PaymentIntents / QBO sandbox rows — leave the external test artifacts, just remove the portal rows. Ship as `scripts/` with a `--dry-run` that lists what it would delete; Scarlett/reviewer runs it via service role at cutover, not before.

### PL-44 (done) · Gwendolyn email typo — fixed in the tutor seed (`TUTOR_ROSTER_SEED.md`), reconciled to the existing row.

### PL-35 / PL-35a · Tutor roster + subject taxonomy seed
Full spec in `docs/TUTOR_ROSTER_SEED.md`: `subjects` table (test_prep vs subject_tutoring — drives QBO mapping), 20 active instructors created with **tutoring OFF** (no emails, no calendar push), real subjects replacing coarse "Foreign Language"-style entries. Asterisk qualifier in the source sheet is still unconfirmed (carried as "(*)" in matching notes) — Scarlett is asking; a one-line seed edit when it comes back.

## B. Bugs

### PL-8 (reinstated) · Missing space in the human-help contact block
Renders "…+1 (801) 524-0817— we're happy…" with no space before the em dash. Confirmed live on the intake page and parent portal footer. Add a space after the `{phone}` variable in the shared contact-block component; it appears on every parent surface.

### PL-49 · Same-date sessions render out of time order
After the PL-2 fix, ISD's 10:00 session (Session 2) lists after its 14:00 session (Session 1). Sort sessions by date **then start_time** everywhere they render — admin class view, parent/instructor session lists, the ICS feed, the calendar landing page, and collateral. Check whether "Session N" labels are stored or derived; if derived from row order, they'll reorder correctly once sorted, if stored they may need recomputing.

### PL-46 · Flyer/letter should print school logos with a transparent background
The ISD logo renders on a white box against the flyer's colored panel. `app/utils/logo-process.ts` already handles logo processing — determine whether it should strip/flatten the background or whether the stored ISD asset needs re-uploading as a transparent PNG. Fix so generated collateral has no white logo box.

## C. Copy

### PL-47 · #3 (Video FAQs) — stop making parents prove we emailed them
The "I didn't receive the diagnostic test link" FAQ currently answers: *"Actually we emailed this information to you very recently. Search your inbox and spam folders for an email titled 'Important diagnostic test information.'"* Two problems: it sends the parent hunting, and the quoted title won't match verbatim (real #2 subject is "Important {schoolNickname} {classType} diagnostic test information"). **Replace with copy that just gives them the link and the deadline directly** — e.g. "No problem — here's your diagnostic test: [button]. It's due {diagnosticDueDate}, the day before your first class. (We also emailed it to you, so check your inbox/spam for future reference.)" Editable in the template editor; final wording below for Code to seed as the new version:

> **What if I didn't get the diagnostic test information?**
> No problem — you can get to it right here: [button:Take the diagnostic test]({synapGroupLink}). It's due {diagnosticDueDate}, the day before your first class. (It also went to your inbox, so it's worth a search of your spam folder for next time.)

### PL-39 · Rename "Leads" → "Prospective students" everywhere user-facing
Page title, the "Leads" nav link, pipeline section labels, the `/admin/leads` heading. Keep the route path if renaming it is disruptive; the visible words are what matter. Applies to the leads page and any admin nav that references it.

## D. Enhancements (approved, ready to build)

### PL-10 (approved) · Auto-advance a prospective student to "Scheduled — won" on schedule creation
When a lead's student actually gets a tutoring schedule created (New Student Schedule wizard), move the lead out of the open pipeline into "Scheduled — won" automatically. Trigger on **schedule creation**, not on family/student record creation (records can exist before a schedule). The lead currently sits stuck at "Intake complete" forever.

### PL-13 (approved) · Register the cancellation emails (CX / CX-W) in the editable template registry
Fold CX (class-cancellation to families) and CX-W (waitlist release) into the same DB-backed template registry pass as T1–T8, so all parent-facing emails are editable in the template editor. Batch with the T1–T8 registration fast-follow.

### PL-42 (approved) · Former-tutors grouping in the tutors panel
Tutors already have an on/off gate; add an Active/Former split with a "reactivate" action instead of deletion (deletion is wrong once a tutor has session/timecard history). Lets Kelsie retire someone without losing their record and bring them back later. Retires the living-document spreadsheet.

### PL-34 (approved) · QBO family importer
One-time bulk import of families/parents from QuickBooks (API pull of Customers, matched by parent email per the Phase 6 decision, or a CSV upload) so Kelsie doesn't hand-type every returning family. **Scope note:** QBO knows families, not students/subjects/grades — import creates the family + parent (name, email, phone); Kelsie adds the student per family. Idempotent (match existing families by email; never duplicate). One-time script preferred over a permanent admin button.

### PL-37 (approved — revised: manual milestone entry, NOT CSV import) · Record scores on the roster
Decision (Scarlett, July 19): **do not build the Synap CSV importer** — Synap's CSVs are hard to parse and the team now uses Synap's own scoring/reporting. Instead, capture just the headline milestone scores by hand, so the portal can show parents progress without duplicating Synap's full reports.
- **No new table / no migration.** `student_scores` already exists (migration `20260708000001_phase4_portal.sql`) with `student_id`, `class_id` (nullable), `test_label`, `section_scores` (jsonb, e.g. `{"EBRW":650,"Math":700}`), `total`, `taken_at`, and staff/parent/instructor/counselor RLS. All four displays (`ScoresTable` in parent/counselor/instructor views) already read it and ship dark until rows exist.
- **Build:** a lightweight "Record a score" entry on the roster where the instructor already takes attendance (admin class view + instructor view; also reachable for tutoring students where `class_id` is null via the student/tutoring surface). Fields: `test_label` (free text with suggestions — "Diagnostic", "Practice Test 1", "SAT", "ACT"), optional per-section inputs feeding `section_scores`, a `total`, and `taken_at` (date). Rows are editable/deletable; stamp `recorded_by`. A student accrues only a handful per course (diagnostic → practice tests → real test), so this is a few numbers, not a grid.
- Net: the existing parent/counselor/instructor score displays light up from data staff already have in front of them, with zero parsing and no Synap round-trip.

### PL-36 (verify — likely already shipped) · Fuller intake form
The four fields (student phone, student email, second guardian, allergies/needs) plus the availability grid landed with the PL-19 work and are live on `/intake/{token}`. **Action for Code:** confirm all four persist to the family/student records (not just the availability grid), then the Google intake form can be retired. If any field only displays and doesn't save, that's the gap to close.

### PL-38 (approved) · Public inquiry form → prospective-students pipeline
Replace the "email → Kelsie transcribes" loop for website inquiries. Build a portal-hosted public form (same pattern as `/register/{slug}`: Squarespace stays the marketing shell, its "Get started / Have more questions?" buttons point at the portal form, or embed it). Submissions create a prospective student at the top of the pipeline with a `source` tag (which page/form). Superset of the six Squarespace form variants: parent name/email/phone, student name/school/subject, "how do you prefer to connect", and a free-text "other info" (grade/scores/goals). **Keep it short** — it's a cold-inquiry form; the fuller intake (PL-36) is sent later once there's a real conversation. Do NOT merge with PL-36 (different moment: cold inquiry vs committed-and-scheduling).

### PL-40 / PL-41 (approved, copy signed off) · Session-setup comms + parent approval
See `docs/SESSION_SETUP_COMMS_SPEC.md`. In short: (PL-40) stop sending a separate Google Calendar invite per generated session — push sessions to the tutor's calendar only, and send the family ONE warm "regular sessions are set up" email with calendar-subscribe links + PDF schedule; (PL-41) a toggle in the New Student Schedule wizard to send the proposed schedule to the parent for one-click approval (with nudges, like the counselor classroom-request flow), plus an override to set it up directly. **Email copy is APPROVED** (July 19); the three emails send **from the configured tutoring contact** (Kelsie now — see PL-50), not a hardcoded address.

### PL-50 (approved) · Configurable tutoring point-of-contact, admin-only
Today the contact block everywhere (parent tutoring surface, reschedule screens, intake footer, `contactBlockHtml` in email bodies) already reads `contact_email` / `contact_phone` from `app_settings` via `loadContactInfo()` — there is exactly one hardcoded `kelsie@` in the codebase (the fallback in `app/utils/tutoring-emails.ts:20`). So the value is already centralized; what's missing:
- **A `contact_name` key** in `app_settings` (e.g. "Kelsie Rank") alongside the existing email/phone, so senders and copy can address her by name, not just show an address. Seed the current real values explicitly (name "Kelsie Rank", email kelsie@highergroundlearning.com, phone +1 (801) 524-0817) so nothing relies on the hardcoded fallback.
- **An admin-only settings card** to edit name/email/phone — gated `is_admin()`, **hidden from the manager role** (Kelsie is a manager; she should not be able to reassign who the contact is — it's an ownership decision). This is the first admin-only-visible element inside `/admin` (managers currently see the whole admin UI), so gate it explicitly.
- **The three PL-40/41 tutoring emails send FROM this configured contact** (name + email as the From identity), so reassigning the contact updates both the From line and every contact-block mention at once. Confirm no other surface hardcodes the address (grep clean except the one fallback).
Net effect: when the tutoring point-of-contact is someone other than Kelsie later, an owner changes it in one admin-only place and it propagates everywhere.

## E. Decisions recorded (no build)

- **PL-12 — declined.** No human-help contact block on the public registration page. Parents reach the portal only after seeing email/phone/WhatsApp/chat on the Squarespace site; by the register step they've chosen to pay, and an extra contact block would just invite hesitation.
- **PL-32 — no merge.** The duplicate students are hasty April test rows; all three create-paths correctly dedupe, so there's no live bug. They're removed by PL-48's purge, not a merge script.

---

## Suggested order
1. Chunk A data-integrity (PL-15 revert, PL-49, PL-46) + the tutor seed (PL-35) — these affect what real onboarding sees.
2. Copy (PL-8, PL-47, PL-39) — cheap, high-visibility.
3. Enhancements (PL-10, PL-13, PL-42, PL-34, PL-37, PL-38, PL-50) — independent; PL-13 rides the T1–T8 registry pass; PL-50 should land before/with PL-40/41 since those emails depend on it.
4. PL-40/41 from the companion spec — copy is approved; senders resolve from PL-50's setting.
5. PL-48 purge script written now, RUN only at cutover (dry-run reviewed first).

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-19.md`, `docs/SESSION_SETUP_COMMS_SPEC.md`, and `docs/TUTOR_ROSTER_SEED.md`.
>
> Build in the order the fixes doc suggests: (1) chunk A data-integrity — PL-15 revert (collateral prints `enrollment_deadline`, with the admin helper text and the in-person deadline default), PL-49 session time-ordering, PL-46 logo transparency — plus the PL-35 tutor/subject seed migration (tutoring OFF for everyone, no emails/pushes); (2) the copy fixes PL-8, PL-47, PL-39; (3) the enhancements PL-10, PL-13, PL-42, PL-34, PL-37, PL-38, PL-50, and verify PL-36 persists; (4) PL-40/PL-41 from the companion spec (copy is approved; senders resolve from PL-50's configurable contact — land PL-50 first); (5) write the PL-48 purge script with a `--dry-run` default and DO NOT run it.
>
> Rules: keep PL-x IDs in commit messages; `git push` after committing (Vercel deploys from GitHub — unpushed = stale prod); if a change needs DB writes you can't perform, leave an idempotent migration + note it at handoff; don't touch remaining QA data except via the PL-48 script; standing copy rules apply (plain-English statuses, "Ops Director", no "engagement", contact block on parent surfaces). Update this doc with a ✅/note per item when shipped.
