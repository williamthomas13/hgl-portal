# HGL Portal — Communications Dashboard, Attendance, Parent Dashboard Spec

**Status:** v1.2 — July 10, 2026 (all open questions resolved; re-sequenced against the July 9 handoff: Phases 3–4.5 are built, Phase 6 underway). Companion to `hgl-portal-master-spec.md` (v2.3) and `hgl-handoff-2026-07-09.md`. Written for Claude Code.
**Scope:** Three new feature areas: (A) admin communications dashboard with DB-managed editable email copy, (B) instructor attendance + send-from-portal class messaging, (C) parent dashboard with attendance and enrollment info.

---

## 0. Sequencing (updated July 10, 2026 per the July 9 handoff)

Original draft assumed Phases 3–4 were unbuilt; they are now live in production (auth + RLS, instructor/counselor/parent views, class creation wizard), and Phase 6 (QBO) is mid-implementation. Revised placement:

- **All three features are now unblocked** — auth, roles, RLS, and the three portal views they extend already exist. These are extensions to shipped surfaces, not new phases: Feature B extends the live instructor view, Feature C extends the live parent view, Feature A lives in the existing admin area.
- **Don't interleave with Phase 6.** QBO implementation is underway with Code; land it (or reach a stable pause point) before starting Feature A's scheduler refactor to avoid two concurrent invasive changes to the webhook/queue layer.
- **Suggested order after Phase 6:** A1–A3 (comms dashboard on the existing Phase 2 send pipeline) → A4 (DB-backed editable templates + copy migration) → B1–B2 (attendance on the live instructor view) → B3 (class messaging — depends on A's `email_sends` log) → C (parent dashboard additions). Attendance (B1–B2) has no dependency on A and can be pulled forward if instructors need it sooner (e.g. before the next in-person weekend cohort).
- **Roles:** Phase 3 shipped admin/manager; Phase 4 views imply instructor/counselor/parent access exists. Code should confirm how instructor and parent identities are modeled in the live RLS setup and reuse that — do not invent a parallel role system. Manager role: grant managers the same comms-dashboard access as admin (operational, no ownership implications).
- The tutoring-hours widget in C3 remains stubbed pending the TutorBird-replacement phase, which is now next up for scoping — keep the widget's data contract compatible with whatever that scoping decides.

---

## Feature A — Communications dashboard

### A1. Purpose

One admin screen answering: *what is scheduled to go out, what has gone out, did it arrive, was it opened/clicked* — so when a parent says "I never got that email," admin can answer "sent July 3, 8:00 AM, opened July 3, 8:14 AM" in seconds. Also the control panel for pausing, cancelling, rescheduling, and (A4) editing email copy.

### A2. Data model

**`email_sends`** — one row per individual email to one recipient. This is the canonical send log.

- `id` uuid PK
- `template_key` text (e.g. `E4_CLASS_DETAILS` — see A4 registry)
- `enrollment_id` FK nullable (null for admin notifications / instructor messages)
- `class_id` FK nullable (denormalized for per-class filtering)
- `recipient_email` text, `recipient_role` enum (`parent | student | counselor | admin | instructor`)
- `scheduled_for` timestamptz — when it should/did leave
- `status` enum: `scheduled | held | cancelled | sending | sent | delivered | bounced | complained | failed`
- `sent_at`, `delivered_at`, `first_opened_at`, `first_clicked_at`, `bounced_at` timestamptz nullable; `open_count`, `click_count` int default 0
- `resend_email_id` text — Resend's ID, for webhook correlation
- `subject_rendered` text — the actual subject sent (snapshot)
- `body_snapshot_id` FK → `email_template_versions` (A4) — which copy version was used
- `hold_reason` / `cancel_reason` text nullable, `cancelled_by` text nullable
- created/updated timestamps

Scheduled-but-unsent emails are **rows in this table with `status='scheduled'`**, created/recomputed by the Phase 2 scheduler when an enrollment is created or dates change. This makes "upcoming" and "history" the same table with different status filters — no separate queue model. Date-change recomputation updates `scheduled_for` on scheduled rows only (sent rows are immutable history, matching the existing "sent emails never re-send" rule).

**Engagement tracking:** enable Resend open + click tracking on the sending domain. Add a Resend webhook endpoint `/api/webhooks/resend` consuming `email.sent`, `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained` → update the matching `email_sends` row by `resend_email_id`. (Note in UI: open tracking is approximate — Apple Mail privacy proxying inflates opens; absence of an open doesn't prove non-delivery. `delivered` is the strong claim.)

### A3. Dashboard UI (`/admin/communications`)

- **Upcoming tab:** all `scheduled`/`held` sends, soonest first. Filters: class, template, audience, date range. Each row: email name+number, recipient, class, scheduled time (school-local shown with timezone), status. Row actions: **Cancel** (with reason), **Hold/Release**, **Reschedule** (datetime picker), **Preview** (renders the template with that enrollment's real variables), **Send now**.
- **History tab:** sent/delivered/bounced/cancelled/failed, newest first. Same filters plus free-text recipient search. Each row shows sent time, delivered ✓, opened (count + first time), clicked (count + first time). Row → detail drawer with full event timeline and the rendered body snapshot ("show exactly what they received").
- **Per-enrollment thread view:** from an enrollment in admin, "Communications" link → all sends for that enrollment in timeline order. This is the "prove we sent it" view.
- **Bulk actions:** cancel/hold all scheduled sends for a class (e.g. class cancelled).
- Cancelling a PR (payment reminder) does not change enrollment status; cancelling #4/#5 etc. is per-send. Guard rails: confirm dialogs; cancelled sends are kept (status change), never deleted.

### A4. Editable email copy (DB-backed templates)

Move body copy out of code into the database, keeping layout/rendering in React Email.

**`email_templates`** — the registry, one row per email:

- `template_key` text PK (stable code identifier: `E0_CONFIRM_PARENT`, `E0_CONFIRM_STUDENT`, `PR1`…`PR4`, `E1_THANKS`, `E2_DIAG_PARENT`, `E2_DIAG_STUDENT`, `E3_VFAQ`, `E4_CLASS_DETAILS`, `E5_LOCATION`, `E6_DIAG2`, `E7_REVIEW`, `E8_POSTCLASS_TUTORING`, `E9_UPSELL`, `W1_WAITLIST`, `W2_SPOT_OPEN`, `SU_SCHEDULE_UPDATE`, plus `IM_INSTRUCTOR_MESSAGE` from Feature B)
- `display_name` text (e.g. "#4 — Class details"), `sequence_number` text
- `audience` enum, `from_identity` enum (`info | billy`), `category` enum (`transactional | relationship`) — drives the existing unsubscribe-footer policy
- `active_version_id` FK → versions

**`email_template_versions`** — immutable versions:

- `id`, `template_key` FK, `version_number` int
- `subject` text, `preheader` text, `body_markdown` text — body is markdown with `{variable}` placeholders; the React Email shell renders it (headings, buttons via a `[button:Label](url-variable)` convention, testimonial blocks as markdown sections)
- `variables_used` text[] (extracted on save), `notes` text ("why changed"), `created_by`, `created_at`

**Permissions (decided July 10):** the template editor — and template viewing generally — is admin + manager only. Instructors never see or edit sequence templates (their only send surface is B3's class messaging). This applies to all templates including relationship emails #3/#6.

**Editor UI** (`/admin/communications/templates`): list of all templates with name, number, audience, from, last-edited. Edit screen: markdown editor with a variable-palette sidebar (click to insert; only the standard variables from master spec §7), live preview rendered with sample data, **save as new version** (never overwrite), version history with diff + one-click revert (revert = new version copying old content), and **send test to me** (renders with sample data to admin's email, logged with status `sent` and a `test` flag or template_key suffix).

**Validation on save:** every `{variable}` must be in the known-variables list (block save on typos like `{studenFirstName}`); warn (non-blocking) if a variable used by the previous version was removed. Audience-aware pronoun rendering (`{isStudent ? … : …}` fix pattern) is expressed as paired variables (`{you_or_name}`, `{your_or_names}`, `{dont_or_doesnt}` etc.) rather than raw conditionals, keeping the editor safe for non-developers — Code should define this set while migrating copy.

**Render path change:** scheduler → look up `active_version_id` at send time → render markdown into the React Email shell → send → stamp `body_snapshot_id` on the `email_sends` row. Editing copy affects only future sends; history always shows what was actually sent.

**Migration:** seed all 15 templates' approved copy (from `hgl-phase2-email-copy-deck.md`) as version 1. This is the fiddly part — verify each seeded template against a test-send before flipping the scheduler to DB templates.

---

## Feature B — Instructor attendance + class messaging (Phase 4a)

### B1. Attendance data model

**`attendance_records`** — one row per (enrollment × session):

- `id`, `session_id` FK, `enrollment_id` FK (unique together)
- `status` enum: `present | absent | late | left_early | late_and_left_early` — OR model as `status: present|absent` + booleans; **preferred:** `present` boolean + `arrived_late` boolean + `left_early` boolean (composable, simpler UI logic)
- `minutes_late` int nullable, `minutes_left_early` int nullable (optional precision — instructor can tap "Late" without a number, or add "45")
- `note` text nullable (free text, e.g. "family emergency")
- `recorded_by` (instructor user id), `recorded_at`, `updated_at`

**Tracking threshold (decided July 10):** arrivals/departures within 0–9 minutes of session start/end are NOT tracked — the student is simply Present. Late/Left-early is only marked at **10+ minutes** (rationale: 10 min shaved off both ends × 8 sessions = 80 min, over 8% of class time — that's the scale worth capturing). Surface this in the UI as helper text on the Late/Left-early chips ("10+ minutes only").

**Computed attendance %** (used by Feature C): for each *past* session, minutes attended = session duration − (minutes_late ?? default) − (minutes_left_early ?? default), floor 0; absent = 0. Default when the flag is set but minutes are blank: **10 minutes** (the minimum trackable amount — a bare "Late" tap asserts at least the threshold, never more). Percentage = Σ minutes attended ÷ Σ duration of past sessions. Show both "sessions attended: 3/4" and "class time attended: 84%".

### B2. Attendance UI (instructor view)

- Instructor logs in (Phase 3 role) → "My classes" → class → **sessions list** with per-session attendance state (Not taken / Partially taken / Complete ✓).
- Taking attendance: roster as large tap targets, one row per student, default **Present**. Tap cycles or exposes chips: `Present · Absent · Late · Left early` (Late and Left early combinable). Tapping Late/Left early reveals an optional minutes stepper (starts at 10, minimum 10; +5/+15 quick buttons) and note field. **Save all** at bottom; autosave per row also fine. Must be comfortable on a phone — instructors will do this in the classroom.
- Editable after the fact (correcting mistakes); `updated_at` tracks it. Admin can view/edit all attendance from the admin class view.
- Admin roster view gains an attendance summary column per student.

### B3. Send-from-portal class messaging

- From the class view, instructor hits **Message class** → compose form: audience checkboxes (Students / Parents / Both — default Both), subject (pre-filled `{schoolNickname} {classType}: `), body (plain textarea, rendered into the standard email shell), optional "CC me".
- Sends via Resend, **From:** `{instructorName} via Higher Ground Learning <info@highergroundlearning.com>`, **Reply-To:** instructor's email — replies go straight to the instructor without giving instructors raw send access to HGL's domain identity.
- Every recipient gets an individual send (no exposed CC list); each is logged in `email_sends` with `template_key='IM_INSTRUCTOR_MESSAGE'` and `class_id` — so instructor messages appear in the admin communications dashboard and the per-enrollment thread automatically.
- Respects nothing re: `marketing_opt_out` (these are operational class messages = transactional footer, no unsubscribe link).
- Rate/abuse guard: confirm dialog showing recipient count; admin notification (weekly digest line) of instructor messages sent.
- Also include the low-end convenience anyway: a **"Copy emails"** button on the roster (parents / students / both) — near-zero cost and useful when instructors want their own mail client.

---

## Feature C — Parent dashboard (Phase 4b)

Parent logs in (Phase 3) → dashboard scoped to their family.

### C1. Next-session callout

Prominent card at top per active enrollment: **"Next class: Sat July 18, 10:00 AM–12:00 PM · Room 204"** (school-local time), with Add-to-calendar linking to the existing §11 calendar landing page. Before session 1, this same card is the "upcoming class" info: class name, school, first session date, session calendar, diagnostic due date + Synap link (mirrors email #2 content so parents can self-serve).

### C2. Attendance panel (per active/completed enrollment)

- Headline stats: sessions attended (e.g. 3/4) and **% of class time attended** (from B1's computation), only counting past sessions.
- Per-session list: date, status chip (Present / Absent / Arrived 45 min late / Left 20 min early). Instructor notes are **not** shown to parents (internal); add a separate `parent_visible_note` later only if needed.
- Empty state before any attendance is taken: "Attendance will appear here after the first session."

### C3. Enrollment history & gentle upsell

- **Past classes:** list of completed enrollments (class, school, dates, final attendance %). Receipts link (already planned Phase 4 parent view).
- **"You might be interested in" card:** if a class exists at the student's school with the same `class_type` family or a designated follow-on, show it with a register link. Mechanism: add nullable `classes.follow_on_class_id` (admin sets "Part 2" pointer when creating it); fallback heuristic: open classes at the same school the student isn't enrolled in. Subtle — one card, no more.
- **Tutoring package widget (stub):** if the family has `enrollment_addons`, show "1-on-1 tutoring: 10 hours purchased" and, until the TutorBird-replacement phase lands, "— scheduling coming soon / contact us to book". Hours-remaining and upcoming-session display are explicitly deferred to that phase; build the widget so it can slot those in.

---

## Cross-cutting notes for Code

1. Build A2's `email_sends` as part of (or a refactor of) the Phase 2 scheduler — do not create a second source of truth for scheduled sends.
2. All timestamps stored UTC; render in school timezone (existing `schools.timezone`), with admin's local time on hover.
3. RLS (already live — add policies to the existing setup): instructors read/write attendance only for their classes; parents read attendance only for their students; **counselors read attendance for their school's students** (surface a summary in the existing counselor view — sessions attended + % per enrollment); `email_sends` admin/manager-only except instructors see their own IM_ sends; `email_templates`/`email_template_versions` admin/manager-only.
4. Indexes: `email_sends(status, scheduled_for)`, `email_sends(enrollment_id)`, `email_sends(resend_email_id)`, `attendance_records(session_id)`, `attendance_records(enrollment_id)`.
5. Suggested build order (post-Phase 6): A1–A3 → A4 → B1–B2 → B3 → C. B1–B2 can be pulled forward independently of A.

## Open questions — all resolved (July 10, 2026)

- ~~Default minutes for a bare Late/Left-early tap~~ → **10.** Late/early under 10 minutes is not tracked at all; 10+ minutes is. See B1 tracking threshold.
- ~~Counselor attendance visibility~~ → **Yes.** Counselors see attendance for their school's students in the counselor view. See cross-cutting note 3.
- ~~Template editor permissions~~ → **Admin + manager only, never instructors**, for all templates including #3/#6. See A4 permissions.
