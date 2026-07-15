# HGL Portal — Phase 7: 1-on-1 Tutoring (TutorBird Replacement)

**Status:** v1.4 — July 15, 2026. Scoped with Scarlett; all §10 open items resolved July 10; onboarding/intake (§11) and policy agreements (§12) added from the Ops Director's onboarding doc + current Google Form policies; pick-from-offered-slots parent reschedule added to §8/7d (July 15). Terminology note: "OM" in this doc = **Operations Director (Ops Director)** — all UI copy uses the new title, and UI never says "engagement" (student-centric copy per July 13 decision). Written for Claude Code.
**Companions:** `hgl-portal-master-spec.md` (v2.5), `hgl-phase6-spec.md` (QBO sync), `hgl-comms-attendance-parent-spec.md` (v1.2 — C3 tutoring widget stub), `hgl-handoff-2026-07-09.md`.
**Depends on:** Phases 3/3.1 (auth, roles, RLS), Phase 4 (portal views), Phase 6 (QBO sync pipeline — reused for tutoring revenue).

---

## 0. Context & scope decisions (resolved July 10, 2026)

The four scope questions from the July 9 handoff, answered:

1. **What would be missed from TutorBird?** HGL never actually used TutorBird — the target is the *workflow it would have replaced*: calendar-based billing and timecard generation. Today: tutors manually fill out a biweekly timecard by looking back at their Google Calendar; the Office Manager (OM) schedules sessions in tutors' Google Calendars, emails **calendar screenshots** to every parent each month to propose the next month's schedule, then bills each family at month-end for the upcoming month via QBO invoice, and handles change requests by email. It works but it is all manual. Phase 7 automates: **timecards derived from the schedule**, **monthly invoices derived from the schedule**, and **the monthly schedule proposal to parents**.
2. **Availability:** tutors set their own availability by blocking time in their Google Workspace calendars. The **OM assigns sessions** — matching on availability, subject knowledge, and personality fit. Parents/students never self-book or browse tutor calendars (deliberate: curated matching drives retention and results). Phase 7 preserves this: no public tutor-picker, ever.
3. **Billing model:** set fee per hour, varying by subject. Most 1-on-1 families do **not** buy hour blocks — they agree to a recurring schedule and are **billed monthly in advance** for the coming month's sessions. Package hours (`enrollment_addons`) are the secondary path: a prepaid balance that sessions draw down. Because the month is prepaid, sessions are **rescheduled, never refunded**: ≥24h notice = free reschedule (tutor notified, paid when it happens); <24h notice or no-show = the prepaid session is forfeited or rescheduled with a **$40/hour fee** (per the current signed policy), because the tutor is still paid for the reserved time. OM discretion for emergencies.
4. **Standalone clients are in scope** — they are the *primary* audience (that's where the OM's manual work is). Class-add-on students benefit too. Critical requirement: **one source of truth per family** across group classes, packages, recurring tutoring, siblings, and repeat engagements, including billing preferences ("auto-charge mom's card, invoice to her assistant, CC mom").

Design decisions made during scoping:

- **Portal is the scheduling source of truth**, but it must not degrade the Google Calendar experience: every portal session is pushed to Google Calendar (§4). Tutors keep blocking availability in their own calendars; the portal reads their busy times.
- **Stripe is the single payment rail** for tutoring (as for classes). Enable **ACH Direct Debit** (0.8% capped at $5 — cheaper than QBO Payments' 1% ACH and than any card rate above ~$625) plus cards; families may opt in to auto-charge a saved card/bank account. Phase 6's sync posts everything to QBO. QBO remains books + payroll only — no QBO Invoices are created by the portal.
- **Monthly proposal becomes propose + confirm** (§6): automated email + portal schedule page replaces calendar screenshots; parent confirms or requests changes; auto-confirm after a grace window.
- **Timecards are hours-only** (§7): pay rates stay in QBO Payroll; the portal never stores tutor pay rates.

## 1. Purpose

Turn `enrollment_addons` hours and standalone tutoring engagements into scheduled, billed, and paid-out sessions, with: an OM scheduling surface that replaces Google-Calendar-first scheduling; automatic biweekly tutor timecards; automatic monthly parent invoices (Stripe → QBO via Phase 6); a parent-facing schedule + confirmation flow replacing screenshot emails; and the unified family record ("group SAT class → 5-hour package → recurring tutoring → sibling in Biology → auto-charge mom, invoice her assistant").

Out of scope for Phase 7: parent/student self-scheduling, tutor self-scheduling of student sessions, tutor pay computation, session notes/progress reports (future), Synap integration.

## 2. Roles

- **New role: `tutor`** (added to the Phase 3 `profiles` enum). Kept distinct from `instructor` because RLS scopes differ (instructor → classes/rosters/attendance; tutor → own tutoring sessions/timecards) and because staff who do both need both surfaces — model as one account whose role is checked per-surface: if the same person tutors and instructs, prefer a `profiles.is_tutor` boolean alongside the existing role over a second account. Code should pick whichever composes best with the live RLS setup, but **do not** create parallel auth.
- **OM = manager role** (Phase 3.1). All Phase 7 admin surfaces admit admin + manager (`is_staff()`), consistent with the operational-access model.
- **Parents** see their family's tutoring schedule, invoices, and confirmations in the Phase 4 parent view (extends comms/attendance spec Feature C — this phase un-stubs C3's tutoring widget).

## 3. Data model

New tables (all timestamps UTC; render in family/tutor local timezone — tutoring is not school-scoped, so timezone comes from the tutor and family records, defaulting to the org's home timezone).

**`tutors`** — profile row per tutor: `id`, `profile_id` FK → profiles (nullable until account created), `name`, `email` (Google Workspace address — used for Calendar API), `google_calendar_id` (usually = email), `subjects` text[], `default_location` (online link or in-person), `timezone` (IANA), `active`, `notes` (admin-only: personality/matching notes).

**`subjects`** (or reuse a simple lookup) — `id`, `name`, `hourly_rate` numeric, `category` enum: `test_prep | subject_tutoring`. Rates vary by subject; rate stored on the subject, overridable per engagement (below). Category drives QBO revenue mapping (§6.4): test prep (SAT/ACT/GRE/GMAT tutoring) → income account **408-1**; subject tutoring (ongoing math/science/etc. help) → **401**. Seed from current rate sheet.

**`tutoring_engagements`** — the recurring agreement between one student and one tutor for one subject. This is the core object; it is what "reserved sessions that stay with us" means.
- `id`, `student_id` FK, `tutor_id` FK, `subject_id` FK
- `hourly_rate` numeric — snapshot/override; engagement rate wins over subject default
- `funding` enum: `monthly_billed` (default — bill month in advance) | `package` (draws down `enrollment_addons` hours; no monthly invoice until the balance is exhausted, then OM may convert to `monthly_billed`)
- `addon_id` FK → enrollment_addons, nullable (required when `funding='package'`)
- `recurrence` jsonb — array of weekly slots: `[{weekday, start_time, duration_minutes}]` (supports 2×/week etc.)
- `location` text (online link / address; default from tutor)
- `status` enum: `active | paused | ended`; `start_date`, `end_date` nullable
- `notes`, created/updated

**`tutoring_sessions`** — one row per concrete session (the schedulable/billable unit):
- `id`, `engagement_id` FK (denormalized `student_id`, `tutor_id` for cheap RLS/queries)
- `starts_at`, `ends_at` timestamptz; `duration_minutes` generated
- `status` enum: `proposed | confirmed | completed | rescheduled | forfeited | no_show`
  - `proposed` — generated for next month, awaiting parent confirmation
  - `confirmed` — locked in (parent confirmed or auto-confirmed); pushed to Google Calendar
  - `completed` — session happened (auto-flip after `ends_at` unless in a terminal state; tutor can correct — see §7)
  - `rescheduled` — terminal pointer state; `rescheduled_to_id` FK → the replacement session; `reschedule_notice` enum `ok | late` (≥24h = free; <24h = replacement carries a **$40/hour reschedule fee** line on the next invoice, per signed policy)
  - `forfeited` — <24h change or no reschedule wanted; prepaid amount is not refunded (the month is prepaid — nothing new is billed); tutor still paid (§7)
  - `no_show` — student absent without notice; treated as `forfeited` with its own label for reporting; tutor still paid
  - There is **no cancel-with-refund state**: the monthly-in-advance model means changes within a paid month are reschedules or forfeits. Dropping future months = edit/end the engagement before the next generation run (§6.5). OM can always add a manual `credit` invoice line for discretionary exceptions (emergencies, per policy).
- `rate_snapshot` numeric (copied from engagement at generation — rate changes never rewrite history)
- `gcal_event_id` text nullable, `gcal_synced_at` (§4)
- `invoice_id` FK nullable (§6), `timecard_id` FK nullable (§7)
- `cancelled_at`, `cancelled_by` (parent | tutor | staff), `cancel_note`
- One-off sessions (no recurrence) are rows with an engagement whose `recurrence` is empty, or a dedicated one-off engagement — Code's choice; do not create a parallel one-off table.

**`families` additions** — billing preferences (the "mom's assistant" requirement):
- `billing_email` text nullable (invoice recipient; defaults to `parent_email`)
- `billing_cc_emails` text[] (e.g. CC mom when the assistant is primary)
- `autopay` boolean default false; `stripe_customer_id`, `stripe_payment_method_id` nullable (saved card/ACH via Stripe SetupIntent — collected through a portal "save a payment method" flow with explicit consent language; never store card data ourselves)
- `billing_notes` text (staff-only)

**`tutoring_invoices`** — one per family per month:
- `id`, `family_id`, `period` date (first of month billed), `status` enum: `draft | proposed | confirmed | invoiced | paid | past_due | void`
- `line_items` via **`tutoring_invoice_lines`**: `invoice_id`, `session_id` nullable, `description`, `qty_hours`, `rate`, `amount`, `kind` enum (`session | late_cancel_fee | adjustment | credit`)
- `subtotal`, `total`, `stripe_invoice_id` / `stripe_payment_intent_id` nullable, `sent_at`, `due_at`, `paid_at`
- Late-reschedule fees and mid-month adjustments/credits for the *current* month append to the *next* month's invoice (keeps one invoice per family per month; OM can issue an ad-hoc invoice if needed).
- `kind` values for lines: `session | late_reschedule_fee | late_payment_fee | adjustment | credit`.

**`timecards`** — one per tutor per **semi-monthly** pay period: 1st–15th (payday the 20th) and 16th–end of month (payday the 5th). Fields: `id`, `tutor_id`, `period_start`, `period_end`, `status` enum: `open | tutor_confirmed | approved | exported`, `total_hours` computed, `tutor_confirmed_at`, `approved_by/at`, `notes`.

**Indexes:** `tutoring_sessions(tutor_id, starts_at)`, `tutoring_sessions(engagement_id)`, `tutoring_sessions(status, starts_at)`, `tutoring_invoices(family_id, period)`, `timecards(tutor_id, period_start)`.

**RLS:** staff full CRUD (`is_staff()`); tutor reads own tutor row, own engagements/sessions, reads + confirms own timecards, may update session status within limits (§7); parent reads own family's engagements/sessions/invoices and may confirm proposals and request cancellations for own sessions; deletion guards mirror Phase 3.1 (no deleting sessions on a paid invoice; void/adjust instead).

## 4. Google Calendar integration

Principle: **portal writes, Google displays; Google's busy times inform, portal decides.** One-way push with read-only free/busy — no two-way sync (two-way sync is the fragility trap that would make the portal "compete" with Google Calendar and lose).

- **Setup:** Google Cloud project + **service account with domain-wide delegation** in the HGL Google Workspace, scopes `calendar.events` + `calendar.freebusy`. Admin-only settings page to store credentials; per-tutor calendar = their primary Workspace calendar (`tutors.google_calendar_id`).
- **Push:** when a session becomes `confirmed`, create a Google event on the tutor's calendar (title `Tutoring: {studentFirstName} — {subject}`, location/meet link, portal deep link in description; **attendee: parent/student email optional per family preference** so families can get native Google invites). Store `gcal_event_id`. Updates (reschedule/time change) patch the event; `cancelled_*`/`no_show` after the fact leave it; cancellation before the session deletes it. Sync is a queued job (reuse the Phase 6 cron-worker pattern; idempotent on session id) with a `gcal_sync_log` and admin alert on repeated failure — a Google outage must never block scheduling.
- **Availability read:** the OM scheduling UI calls freebusy for the candidate tutor across the target range and renders busy blocks (from tutors' own self-managed availability blocking plus their pushed sessions) behind the proposed slot. Conflict = warning, not a hard block (OM judgment wins).
- **Tutor behavior change: none.** Tutors keep blocking availability in Google Calendar exactly as today; sessions simply appear in their calendar without the OM typing them in. This is the migration pitch to tutors.
- **The "XCL-" convention:** today the OM marks cancellations by prefixing event titles with `XCL-` in Google Calendar. Post-cutover the equivalent action is the portal's reschedule/forfeit buttons — and for calendar continuity the portal mirrors the convention: a forfeited/no-show session's Google event gets its title prefixed `XCL-` (kept on the calendar, since the tutor is still paid for the slot), while free reschedules move the event. So calendars keep reading exactly as everyone is used to; the direction of writing just reverses. Reading `XCL-` edits *from* Google as an input is deliberately **not** supported (that's the two-way-sync trap) — except as a **migration-period safety net**: a daily read-only job compares titles of portal-pushed events and flags any that were hand-edited to `XCL-` in Google for OM review in the portal ("this session was cancelled on the calendar but not in the portal"). Cheap, read-only, catches habit lapses during the transition; retire it once the habit has moved.

## 5. OM scheduling surface (`/admin/tutoring`)

- **Students & families view:** unified record — family, students, group-class enrollment history (existing tables), packages (`enrollment_addons` with hours remaining), engagements, billing preferences. This is the "one source of truth" screen; the SAT-class→package→recurring→sibling story must be legible on one page.
- **New engagement wizard:** pick student (or create family/student — reuse existing records; **never duplicate a family that came through a group class**) → pick subject → pick tutor (filterable by subject; matching notes visible) → set weekly slots against the tutor's freebusy view → rate (defaults from subject) → funding (monthly vs package with hours balance) → location → start date. Creates the engagement; generates sessions to the end of the current billing horizon.
- **Calendar views:** per-tutor week view and all-tutors day view of portal sessions (+ freebusy shading). Drag-to-reschedule optional/later; edit dialog is fine for v1.
- **Session actions:** reschedule (creates replacement, marks original `rescheduled`, patches GCal), cancel (auto-classifies ok/late by the 24h line against `starts_at`, overridable), mark no-show, add adjustment/waive fee.
- **Package balance:** for `funding='package'` engagements show hours remaining = addon hours − Σ(completed + no_show + confirmed-future session hours). Alert OM when a package has < 2 sessions of runway (upsell/convert moment). This un-stubs comms/attendance spec C3: parent widget shows hours purchased, hours remaining, next session.

## 6. Monthly cycle: propose → confirm → invoice → collect

Replaces: OM screenshots + manual QBO invoices + email back-and-forth.

1. **Generate (cron, the 20th of each month; settings-configurable):** for every `active` engagement, materialize next month's sessions from `recurrence` as `proposed` rows and build a `draft` invoice per family (sessions × rate_snapshot + any carried fees/adjustments). Package-funded engagements generate sessions but no invoice lines while balance covers them; the invoice picks up only the overflow.
2. **Propose (email + portal):** parent gets **"{studentFirstName}'s tutoring schedule for {Month}"** (new template `T1_MONTHLY_PROPOSAL`, from info@, transactional) linking to a portal schedule page: list + mini-calendar of proposed sessions, total, and two actions — **Confirm schedule** and **Request changes** (free-text form → notification to OM; OM edits sessions and the page/invoice update). Multi-student families get one combined email/page. This encodes the existing signed policy: schedule changes for next month must land before month-end, otherwise the schedule rolls over unchanged.
3. **Confirm:** nudge email at **+2 days** if unconfirmed (`T1b_PROPOSAL_NUDGE`); **auto-confirm at +5 days** (stated plainly in both emails — mirrors the current "schedule remains the same unless changed" policy). On confirm, sessions flip `confirmed`, push to Google Calendar, invoice flips `confirmed`. Once confirmed/paid, the month is non-refundable (policy) — changes become reschedules (§3).
4. **Invoice & collect:** invoices go out at month-end (on confirmation or auto-confirm), **due by the end of the month** (settings-configurable; current policy says due by the first scheduled session of the billed month — the portal due date supersedes and simplifies this; keep policy text in sync when agreements are updated, §12).
   - **Autopay families:** charge the saved payment method off-session (PaymentIntent with `stripe_payment_method_id`); receipt email; retries + past-due handling on failure (T4 dunning, 3 attempts over a week, then OM alert).
   - **Non-autopay:** send **Stripe Hosted Invoice** (card + **ACH Direct Debit** enabled) to `billing_email`, CC `billing_cc_emails` — this delivers the assistant-pays-mom-watches requirement natively. `T2_INVOICE` email wraps the Stripe link in HGL voice.
   - **Late-payment escalation (existing signed policy, automated):** unpaid **+10 days** past due → OM alert + reminder email; unpaid **+30 days** → flag for the **10% late fee** on the entire invoice (OM applies as a `late_payment_fee` line — human-in-the-loop, never automatic money) + possible pause of the engagement.
   - Payment webhook (existing endpoint; add `invoice.paid` / relevant PI events) marks paid and **queues the Phase 6 `qbo_sync_log` row**. QBO mapping by subject category (§3): test-prep tutoring → income account **408-1**; subject tutoring → **401** (bookkeeper creates/confirms the two QBO Items; portal maps to Item IDs only, same pattern as Phase 6 §11.1). Per-family QBO Customer matching by parent email carries over unchanged.
5. **Mid-month changes:** parent requests via portal or email → OM edits; changes auto-classified against the 24h rule as reschedules (free) or late reschedules/forfeits (§3); a late reschedule adds the $40/hour fee to next month's invoice. `T3_SCHEDULE_CHANGE` email confirms any change to the parent (reuses the SU changesBlock pattern) and the tutor is notified (email + GCal event patch).

New templates (registered in the Feature-A `email_templates` registry when that lands; hardcoded React Email until then): `T1_MONTHLY_PROPOSAL`, `T1b_PROPOSAL_NUDGE`, `T2_INVOICE`, `T3_SCHEDULE_CHANGE`, `T4_PAYMENT_FAILED`, `T5_TIMECARD_READY` (tutor), `T6_PACKAGE_LOW` (parent, package runway — optional v1), plus §11's intake/onboarding templates.

## 7. Timecards (semi-monthly, hours only)

Pay periods: **1st–15th (payday the 20th)** and **16th–end of month (payday the 5th)**.

1. Cron at each pay-period close builds a `timecard` per tutor with all payable sessions in the period: `completed`, **plus `forfeited`, `no_show`, and late reschedules' original slots — tutors are paid for reserved time regardless** (that is exactly why the family is charged; resolved July 10). Free (≥24h) reschedules move the session — the tutor is paid when it actually happens, in whichever period that falls.
2. Sessions auto-flip `proposed/confirmed → completed` when `ends_at` passes (terminal statuses exempt). Tutor's portal view shows the open period; their only required action is **correcting exceptions** (mark a no-show, adjust an actual duration within staff-approved bounds) and hitting **Confirm timecard**. `T5_TIMECARD_READY` email at period close.
3. OM approves → timecard `approved` → **export view/CSV: tutor, period, total hours** (grouped by rate-relevant category only if pay policy needs it) for manual entry into QBO Payroll. `exported` stamps it done. No pay rates, no dollar amounts, anywhere in the portal.
4. Effect: the twice-monthly "reconstruct my calendar into a timecard" ritual becomes a 60-second review, and the OM's cross-checking disappears — the timecard and the parent invoice derive from the same session rows, so they can't disagree.

## 8. Parent-facing surface (extends Phase 4 parent view / Feature C)

**Human-help principle (design requirement, not a nicety):** the portal is the convenient path, never the only path. Every parent-facing tutoring surface — schedule page, monthly proposal, reschedule flow, invoice page, and the T1–T4 emails — carries a visible "Questions? Call or email us" block with the OM's email and the office phone number (reuse the current invite-description copy: "email kelsie@highergroundlearning.com or give us a call at +1 (801) 524-0817"; pull from a settings value, not hardcoded). Nothing self-serve is mandatory: a parent who replies to any email or calls gets the same outcome, with the OM doing the action in the admin UI on their behalf — the OM's actions and the parent's actions write the same records. Wherever the portal enforces a rule (e.g. the <24h fee screen), the copy offers the human path ("or get in touch and we'll figure it out") rather than a dead end. HGL's differentiator is high-touch service; the portal removes the OM's busywork, not the parent's access to her.

- **Tutoring card per engagement:** tutor first name, subject, weekly slots, next session, location/link.
- **Schedule page:** upcoming confirmed sessions (list + calendar link — extend the §11 ICS endpoint pattern with a per-family tutoring calendar feed), monthly proposal flow (§6) when pending.
- **Billing:** invoice history with Stripe receipt links; manage payment method / autopay opt-in (Stripe SetupIntent); billing contacts editable by staff only (v1).
- **Reschedule request:** parent can request a change to an upcoming session from the portal; ≥24h auto-approves as a free reschedule (Ops Director picks/confirms the replacement slot; tutor notified; GCal event moved); <24h shows the $40/hour policy and routes to the Ops Director to apply forfeit/late-reschedule.
- **Pick-from-offered-slots (added July 15, 2026 — build as part of 7d):** for the ≥24h case, instead of "request and wait," the portal offers the parent **2–3 candidate replacement slots** to tap, and the reschedule completes instantly (session moved, tutor notified, GCal patched, T3 sent). Mechanics: candidates are computed from the tutor's freebusy within **Ops-Director-approved offer windows** — a per-tutor weekly availability mask set in the tutors panel (e.g. "Mon–Thu 15:00–19:00"), defaulting to the tutor's existing recurring-session hours ±2h if unset. Candidates must be within the same billing month, ≥24h out, conflict-free per freebusy, and not displace another portal session. **The tutor's calendar is never exposed** — parents see only the 2–3 offered times, preserving the no-self-booking principle: the Ops Director controls the offer windows, the parent only picks among pre-approved options. If no candidate fits (or the parent wants something else), the flow falls back to the existing free-text request → Ops Director path, and per the human-help principle the offer screen always carries "none of these work? get in touch and we'll figure it out." Parent-completed reschedules appear in an Ops Director activity feed/digest so nothing happens invisibly.
- Package families: hours purchased / remaining / next session (C3 un-stubbed).

## 9. Build order

- **7a — Core scheduling:** schema, tutor records, engagements, session generation, OM scheduling UI, Google Calendar push + freebusy. *Ship when the OM schedules in the portal instead of Google Calendar.*
- **7b — Timecards:** auto-completion, tutor view + confirm, OM approval + export. (Small; immediately kills the manual ritual.)
- **7c — Monthly billing:** propose/confirm flow, T1–T4 emails, Stripe invoices + autopay + ACH, Phase 6 QBO hookup, credits/fees.
- **7d — Parent surface & package integration:** parent schedule/billing pages, reschedule requests **incl. pick-from-offered-slots (§8)**, `enrollment_addons` draw-down, C3 widget.
- **7e — Intake & agreements (§11–§12):** lead intake + onboarding pipeline, in-portal policy agreements. Independent of 7a–7d; can be built in parallel or pulled forward (it replaces the OM's pending-students spreadsheet and Google Forms today, even before scheduling moves).

7a→7b delivers value even before billing changes; 7c is the big OM win; 7d closes the loop. Migration: OM enters current tutors, families, and engagements by hand (small N); first proposed month runs in parallel with one screenshot email as a safety net, then screenshots stop.

## 10. Open items — all resolved (July 10, 2026)

1. ~~Pay policy for no-shows/late changes~~ → **tutors are paid for reserved time, always** (that's why the family is charged). Prepaid sessions are rescheduled, never refunded; ≥24h = free reschedule; <24h/no-show = forfeit or $40/hour late-reschedule fee. See §3, §6.5, §7.1.
2. ~~Pay-period anchor~~ → **semi-monthly: 1st–15th (payday 20th), 16th–EOM (payday 5th).** See §7.
3. ~~QBO account~~ → **408-1** for test-prep tutoring income (SAT/ACT/GRE/GMAT), **401** for subject tutoring. Mapped via `subjects.category`. See §3, §6.4.
4. ~~Cycle dates~~ → **generate on the 20th, nudge at +2 days, auto-confirm at +5 days, due at month-end.** Built as settings. See §6.
5. ~~Google invites~~ → **invite family attendees by default** (online and in-person alike — fewer missed sessions, self-serve visibility), per-family opt-out flag. Event titles stay tutor-oriented (student name first); that's fine for families. See §4.
6. ~~Stripe ACH~~ → **yes, and yes it works in test mode**: enable ACH Direct Debit in the Stripe test-mode dashboard payment-method settings (the current sandbox), pay a test hosted invoice with Stripe's test bank account, and it flows through the same webhook path. Enable again in live mode at cutover (payment-method settings are per-mode). US bank accounts only; international families fall back to card.

## 11. Intake & onboarding (from the OM's onboarding doc)

Today: website "2 free hours" signups trigger an automated email; the OM tracks leads in a "pending students" spreadsheet she distrusts ("an extra step… students flush out too quickly"); she plays email/phone tag collecting a standard question set; consultations get scheduled on Eric's or Jason's calendar; then an intro/handoff email, Google Forms for registration + policies + autopay, and a monthly tracker entry. Her own improvement list: capture more info + availability + online/in-person preference up front, doctor's-office-style forms (open a link, not scan-and-return), and session reminders/no-show reduction. Phase 7e delivers exactly that list:

**`leads`** table (replaces the spreadsheet): `id`, source (`website | referral | call | other`), contact info, student name/school/grade, `interest` (`test_prep | subject | unsure`), subject(s), test date, prior scores, availability text, online/in-person preference, `offer_id` FK nullable, `status` pipeline: `new | contacted | intake_sent | intake_complete | consult_scheduled | consult_done | proposal_sent | scheduled | lost`, `assigned_to`, notes, timestamps. Admin pipeline view sorted by status + staleness ("no touch in 4 days") — the inbox-reality and the tracker stop being two places.

**Intake form (portal page, not Google Forms):** tokenized link `/intake/{token}` emailed from the lead record (`T7_INTAKE_REQUEST`, adapted from her current blanks-template + the Student Registration form). Fields — student name/phone/school+grade/email; guardian name/phone/email (+ optional second guardian); preferred contact method and who to contact if the student hasn't arrived (call/text, student/parent); emergency contact (name/number/relation); how they heard about HGL; reason for coming; special needs/allergies; test prep vs subject + specifics (test date, prior scores / subject needed); **availability** (weekly grid or structured text); **online vs in-person preference**. Submission creates/updates the family + student records directly (dedupe against existing families by email — group-class families skip re-entering what HGL already knows) and flips the lead to `intake_complete`. No scanning, no PDFs: open link → tap through → done, like the doctor's office she described.

**Offers (`tutoring_offers`):** the COVID-era "2 free hours" website offer is retired, but the mechanism should exist for whatever comes back. `id`, `name`, `kind` (`free_hours | percent_off_first_month | fixed_credit`), `value`, `active`, `valid_from/until`, `notes`. An active offer can be attached to a lead (auto for website-source leads if a site offer is live, or manually by the OM); when the lead converts, the offer materializes on the first invoice as comped session hours or a `credit` line, labeled with the offer name so the books stay legible. No offers active at launch.

**Consultation scheduling (v1 = light):** lead record gets a "consult scheduled" state + datetime and owner (Eric/Jason), synced to the owner's Google Calendar via §4's push. Self-serve consult booking is explicitly out of scope for v1 (curated matching principle).

**Handoff automation:** her intro/handoff email becomes template `T8_WELCOME_HANDOFF` with variables (tutor name + contact, first-month schedule, first invoice link, session link if online / address + door code if in person, 24h-notice policy, agreements link (§12), autopay opt-in link). Sent when the first engagement is created; replaces the plug-and-chug template doc. Session reminders (her "doctor's-office reminder" idea) ride the GCal invites from §4 by default (Google's native notifications); a portal T9 reminder email/text is a possible later add — start with invites, measure no-shows.

**International students:** her doc notes international onboarding is already easy (info arrives via Billy/Eric, 100% online) — for these, staff can create family/student/engagement directly and skip the lead pipeline; the pipeline is optional tooling, not a mandatory gate.

## 12. Policy agreements (replaces the Google Forms "signature")

The current Scheduling & Billing Policies Google Form is a survey pretending to be a contract — checkbox-per-clause plus typed name. The portal makes acceptance a first-class record. (On the "does Google have a DocuSign thing" question: yes — Google Workspace eSignature in Docs, on Business Standard+ — but it's built for one-off documents, not a repeatable per-family flow with status tracking; native portal acceptance is simpler, automatic, and legally equivalent for this purpose: a click-through agreement with identity, timestamp, and content snapshot.)

- **`agreement_templates`**: `id`, `kind` (`scheduling_billing_policy` — extensible), `version`, `body_markdown`, `effective_date`, `active`. Seed v1 from the current form's clauses, updated to match §6 (invoice timing/due date, 10-day/30-day escalation, 24h reschedule rule, $40/hour fee, no-refund-after-confirm, month-end change deadline, reduced-rate forms requirement).
- **`agreement_acceptances`**: `id`, `agreement_template_id` (pins the exact version), `family_id`, `accepted_by_name` (typed full name), `accepted_by_email`, `accepted_at`, `ip`, `user_agent`, `pdf_snapshot_url` (rendered PDF of the exact text accepted, stored; reuse the Phase 4.5 `@sparticuz/chromium` PDF pipeline).
- **Flow:** acceptance link included in `T8_WELCOME_HANDOFF` (or sent standalone); page shows the full policy, requires typed full name + checkbox, records acceptance. **Family profile shows agreement status** (accepted vX on date, link to the signed PDF / not yet accepted — chase button resends the link), answering "has this been done?" at a glance instead of digging through Form responses.
- **Guard:** the monthly cycle warns (not blocks, v1) when generating an invoice for a family with no accepted agreement; OM dashboard lists unaccepted families. New policy version → OM can trigger re-acceptance requests; old acceptances remain valid records of what was agreed when.
