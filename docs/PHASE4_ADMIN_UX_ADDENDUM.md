# HGL Portal — Phase 4 Admin UX Addendum

**Date:** July 7, 2026 · Companion to `hgl-phase4-spec.md`
**Scope:** Admin-page improvements and one bug fix, from live testing feedback. Hand to Claude Code alongside the Phase 4 spec.

---

## 1. Bug: session dates save one day early

Sessions entered for e.g. September 12 persist/display as September 11. Root cause is almost certainly UTC date parsing: `new Date("2026-09-12")` is interpreted as midnight UTC, then rendered in a timezone behind UTC, rolling back a day.

**Fix:** treat session dates as plain date strings throughout. Store in a `date` column; never round-trip through a JS `Date` for display. If a `Date` is unavoidable, construct with explicit local components (`new Date(y, m-1, d)`) or use a date-only library path. Audit all admin session read/write/display code for this pattern.

## 2. Timezone handling

No per-class timezone picker needed. Classes inherit the school's IANA `timezone` (already on the `schools` table from Phase 2). Admin UI displays it read-only next to the session editor, e.g. "All times in America/Mexico_City", so it can be verified at a glance.

## 3. Date & time formatting standards (admin)

- **Dates:** unambiguous long form everywhere in the admin: `02 September 2026`. Never numeric slash formats.
- **Times:** 24-hour clock for all session inputs and displays.
- **Time picker:** 5-minute increments only.
- Recipient-facing email/registration copy keeps its existing friendly formats; this standard is for admin surfaces.

## 4. Class creation becomes a wizard (sessions required)

Class creation flow: **(1) class details → (2) sessions → (3) review & create.** A class cannot be created with zero sessions.

Session entry conveniences:
- After adding a session, the next session's form pre-fills with the previous session's values (date, start, end, location); usually only the date changes.
- Adding sessions to an already-live class remains possible but is a secondary/edit path, not part of normal flow (schedules are agreed with families in advance; SU email covers changes).

## 5. Admin layout

- Sections **Add a new class** (renamed from "command center"), **Live class rosters**, **School contacts**, **Instructors** are collapsible for quick navigation.
- **Live class rosters:** live classes render as tabs; click a tab to see that class's roster/details.
- **Admin class view** additionally renders the same visual session calendar shown on the public registration page, for at-a-glance verification.

## 6. Entity consistency — strict selects, no free text

Goal: prevent the "ASF" vs "American School Foundation" split and equivalents for people.

- **Schools:** field becomes a strict select from the `schools` table with an explicit "+ Add new school" action. Free-text entry removed. (Schema already correct — `school_id` FK.)
- **Counselors / school contacts — contact + affiliation model (history-preserving):** replace `school_counselors` with:
  - `contacts` — the person (name, email, phone, notes), school-independent.
  - `school_affiliations` — `contact_id`, `school_id`, `role`, `started_at`, `ended_at` (null = current). A contact changing schools closes the old affiliation and opens a new one; nothing is overwritten.
  - Digest subscriptions, class contact assignments, and digest frequency preferences reference the **affiliation**, not the bare contact — past records stay anchored to the school context they happened in.
  - Migration: each existing `school_counselors` row → one contact + one open affiliation.
  - Admin CRUD: create/edit contacts; add/end affiliations ("move to another school" = end + create in one action).
  - **Sequencing:** land this before Phase 4 counselor login — auth attaches to the contact's email; data visibility scopes through *active* affiliations in RLS. Doing it after would mean rewriting counselor RLS twice.
- **Instructors:** promote from text fields on `classes` (`instructor_name`, `instructor_email`) to a proper `instructors` table (name, email, default meeting link per Phase 4 spec) with `instructor_id` FK on classes and a strict select in admin. Migrate existing text values; keep legacy columns until reads are confirmed switched, then drop (same pattern as `school_nickname`). This also gives Phase 4's instructor login a real entity to attach to.

## 7. Pre-launch data reset (checklist item)

Test/joke classes, registrations, and fake people remain in the database during testing — fine for now. **Before real launch: truncate all test data (classes, sessions, enrollments, families, students, add-ons, waitlist rows) and start fresh.** Add to the launch runbook.
