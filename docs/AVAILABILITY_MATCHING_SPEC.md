# Availability & Matching Spec (PL-19 + PL-28)

**v1.0 — July 17, 2026.** Decisions confirmed by Scarlett this date. Companion to `docs/PHASE7_SPEC.md` (v1.4) and `docs/portal-fixes-2026-07-17.md`. Priority item — build before the fixes-doc chunks.

## Purpose

Kelsie (Ops Director) currently matches students to tutors by eyeballing calendars: a student is available, say, Mon/Wed/Fri 4–8 PM, and she hunts for a tutor with recurring room in that window. This feature captures **student availability** as structured data and makes the portal **suggest workable weekly slots** when she builds a schedule — suggestions only, subject to her approval, consistent with 7a's "warn, never block; the Ops Director's judgment wins."

Decisions locked: availability captured on **both** the intake form and the New Student Schedule wizard · granularity is **weekday + time ranges** in the family's timezone · suggestions surface **inside the wizard** (no standalone matching view; tutor choice stays Kelsie's).

## 1. Data model

New table `student_availability` (or JSONB on students — Code's call; table preferred for querying):

- `student_id` FK
- `weekday` (0–6), `start_time`, `end_time` (local wall-clock)
- `timezone` (IANA — the family's; captured with the ranges, since student and tutor timezones differ)
- `source` enum: `intake | staff`
- `updated_at`, `updated_by`

Multiple ranges per weekday allowed. Empty = unknown (never treated as "unavailable").

## 2. Intake form (`/intake/{token}`)

Add an availability section to the one-page intake: per-weekday rows where the family can add one or more time ranges ("Mon 4:00 PM – 8:00 PM"), with a timezone selector defaulting from the school record or browser. Keep it optional and fast — an incomplete grid must not block intake submission (intake completion rate outranks data completeness). Plain-English microcopy: "When is {student} usually free for tutoring? Rough is fine — we'll confirm exact times with you."

On submit, write rows with `source='intake'`. Existing intake dedupe rules unchanged.

## 3. Wizard capture/edit

In the New Student Schedule wizard, after the student is picked, show their availability grid (from intake if present) with inline editing — Kelsie can enter or correct it during the phone call. Saves with `source='staff'`. This is the same UI component as the intake grid.

## 4. Suggestions in the wizard

Once student + tutor + cadence inputs exist (sessions/week and duration are already implied by the slots Kelsie adds — add explicit "sessions per week" + "duration" inputs that pre-fill the slot builder):

1. Compute candidate weekly slots = student availability ∩ tutor's Google free time ∩ tutor's `offer_windows`-style working hours, on a lookahead of the full generated-session horizon (see §5), normalized across timezones.
2. Rank candidates: fewest conflicts across the horizon first, then respecting spread (e.g. for 2×/week prefer non-adjacent days), then earliest-in-window.
3. Render the top combos as one-click chips ("Mon 4:00 PM + Thu 5:00 PM — no conflicts through October"); clicking fills the weekly-slot rows exactly as if typed. Kelsie can always ignore them and type slots manually — suggestions never gate the Create button.
4. If student availability is empty: show "No availability on file — add it above and we'll suggest times", never an error.

## 5. Freebusy fixes folded in (PL-28)

These change the same conflict path (`app/api/gcal/freebusy/route.ts`, `engagement-wizard.tsx` conflict memo) and ship with this feature:

- **(a) Horizon:** conflict checking covers the whole generated-session horizon, not two weeks. The route caps a request at 45 days — batch sequential requests to cover the horizon; keep the wizard responsive (fetch first window immediately, extend in the background).
- **(b) All-day events:** count an all-day event as busy **only when Google marks it Busy or Out-of-office**; skip transparency=Free (reminders and default all-day events). Multi-day "out of town" blocks marked Busy/OOO must conflict — do not blanket-skip all-day events.
- **(c) Conflict detail:** every conflict row shows the Google event's title (or "busy — private event"), date, and time range so nobody has to open Google Calendar to understand a warning.
- **(d) Dedupe (PL-29):** one row per (event × session occurrence).

## 6. Explicitly out of scope

- Suggesting *which tutor* (standalone matching view) — Kelsie picks the tutor; revisit post-launch.
- Importing Google events into the portal as sessions — the portal stays the scheduling source of truth with one-way push (7a architecture); invoices and timecards derive from portal sessions.
- Parent self-serve editing of availability in the portal — later; staff/intake only for v1.

## 7. Acceptance checklist

- [ ] Intake form captures per-weekday ranges + timezone; optional; submits fine when blank; rows land with `source='intake'`.
- [ ] Wizard shows and edits the same grid; edits save with `source='staff'`.
- [ ] With QA student availability Mon/Wed 3–6 PM Denver and Billy's calendar seeded with a busy block, suggestions exclude the busy times, respect timezone conversion, and clicking a chip fills the slot rows.
- [ ] Suggestions never block manual entry; Create works with suggestions ignored.
- [ ] Conflict warnings cover the full horizon (test with a Google event 8 weeks out).
- [ ] All-day event marked Free produces no conflict; all-day marked Busy/OOO does; conflict rows show title + time; no duplicate rows.
- [ ] Copy: plain English, no phase numbers, student-centric (no "engagement" anywhere user-facing).
