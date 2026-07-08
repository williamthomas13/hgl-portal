# HGL Portal — Phase 5 Spec: Copy a Previous Class

**Date:** July 2026 · Companion to `hgl-phase4-spec.md` and `hgl-phase4-admin-ux-addendum.md`
**Status:** Specced, ready for Claude Code
**Supersedes:** the original roadmap's Phase 5 "courses/templates table" concept. There is **no templates table, no template CRUD, and (likely) no migration** in this phase. Copy-a-previous-class delivers the same value with less machinery.

---

## 1. Purpose

New cohorts are usually near-copies of a school's previous class (same delivery mode, times, price, instructor — only the dates change). Today the wizard starts blank every time. Phase 5 adds a **"Copy a previous class"** entry point that pre-fills the wizard from any past class, so creating "SLS SAT Prep Spring 27" from "SLS SAT Prep Fall 26" takes about a minute.

## 2. Design principles

- **Snapshot semantics.** Copying duplicates values into the new class. No live link between source and copy — editing or deleting the source never affects the copy, and vice versa. (This is inherent to copying; state it so nobody "improves" it into a reference later.)
- **Everything overridable.** Copied values are just pre-filled form fields in the existing wizard. Nothing is locked.
- **Downstream invisibility.** A copied class is indistinguishable from a hand-made one to emails, enrollment lifecycle, waitlist, Stripe, RLS, and the public registration page. No changes to any of those systems.

## 3. Entry point & source selection

- The "Add a new class" section gains two paths: **Start blank** (current behavior, unchanged) and **Copy a previous class**.
- Copy path opens a source-class picker: all classes, most recent first, filterable/searchable by school and class type. Any class may be a source, including completed ones (completed classes are the *usual* source).
- Selecting a source lands the user in wizard step 1, fully pre-filled.

## 4. What copies, what doesn't

**Copied into step 1 (all editable):**
- school (FK), class type, delivery mode, price, capacity, min_enrollment, instructor (FK), synap_group (as a starting point — usually needs updating), default_location.

**Copied into step 2 — sessions, with dates cleared:**
- Each source session becomes a row in the new class's session list with its **start_time, end_time, and location copied** and its **date field empty**. Times repeat across terms; dates never do. The user types the new dates (existing previous-session pre-fill behavior still applies to any *additional* sessions added).
- The wizard's existing rule holds: cannot complete with zero sessions, and every copied session row must receive a date before review.

**Never copied:**
- slug (auto-regenerated from school nickname + class type + new term, editable as usual)
- enrollment_deadline (cohort-specific)
- enrollments, waitlist entries, add-ons (obviously)
- any email state (all sends compute from the new class's own sessions)
- Stripe identifiers of any kind

## 5. Wizard flow (copy path)

1. Add a new class → **Copy a previous class** → pick source.
2. **Step 1 — details:** pre-filled per §4; edit anything (commonly nothing, or price).
3. **Step 2 — sessions:** copied rows with times/locations, dates blank; enter new dates.
4. **Step 3 — review:** identical to current review step; shows the visual session calendar; create.

Cross-school copy is supported implicitly: change the school field in step 1 (e.g. start Nido's class from SLS's structure). Slug regeneration keys off the final chosen school.

## 6. Explicitly out of scope

- Date-shifting intelligence ("move all sessions forward N weeks"). Deferred: with 4–8 sessions per class and everything else pre-filled, manual date entry costs ~1 minute. Revisit only if it proves annoying in practice.
- Boilerplate/recurring session patterns.
- A templates/courses table or any template management UI.
- Collateral regeneration on copy (flyers/letters — Phase 4.5's domain; natural future synergy, not built here).
- Any change to emails, lifecycle, waitlist, checkout, or public pages.

## 7. Implementation notes for Code

- Expected to require **no schema changes**. If any migration does prove necessary, it must be idempotent and include RLS + policies in the same file per the standing rule (Security Advisor must show zero findings post-apply).
- The copy read happens in the admin (staff-only) context; existing `is_staff()` policies on classes/sessions should already cover it — verify rather than assume.
- Copying must read the source through current canonical fields (`school_id` → schools.nickname, `instructor_id`), never legacy text columns. **Prerequisite/companion cleanup:** drop `classes.school_nickname`, `instructor_name`, `instructor_email` once reads are confirmed migrated (small idempotent migration). Do this before or with Phase 5 so copies can't propagate deprecated columns.
- Source picker should paginate or lazily load; class count will grow.

## 8. QA checklist (post-deploy)

- Copy a completed class → verify every §4 "copied" field arrives pre-filled and every "never copied" field is absent/regenerated.
- Verify session rows arrive with times/locations and blank dates; cannot reach review with a blank date.
- Enter dates and confirm they save/display as entered (regression check on the UTC date bug).
- Cross-school copy: change school in step 1 → slug regenerates for the new school.
- Edit the source class afterward → copy is unaffected (snapshot check).
- Register a test student in a copied class end-to-end → confirmation emails render the correct new-class values ({schoolNickname}, {firstSessionDate}, {classTime}).
