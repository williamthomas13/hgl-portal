# Phase 4 launch runbook

Code is complete and building (`next build` clean, eslint clean). The steps below are the ones
the agent could not do (prod DDL / Vercel env / Supabase dashboard are approval-gated), in
order, plus go-live behavior you should know about **before** deploying.

## 1. Migrations — July 7 status: 0001 applied; 0002 (REWRITTEN) and 0003 still pending

**The July 7 "No classes exist yet" bug was migration 0002 never having been applied**: the
admin roster query selects `enrollments.class_cancelled`, which didn't exist, so the read
failed for everyone (verified: it failed even for the service role — not RLS, and not the
allowlist). Writes don't touch the new columns, hence the confusing success-banner-but-empty
-list symptom. The admin page now shows read errors instead of masking them as an empty list.

**All three Phase 4 migration files are now IDEMPOTENT — running the full set
0001 → 0002 → 0003 in order is always safe, including over a database where some or all of
them already applied.** (The July 7 SQL-editor rollback — `policy "staff all" for table
"student_scores" already exists` — was 0001 content being re-run: that statement only exists
in 0001, which was already live. 0001's policies now have `drop policy if exists` guards, so
even that re-run is harmless.)

Apply, in order (or just run all three):

1. `20260708000001_phase4_portal.sql` — already applied in prod; now re-run-safe.
2. `20260708000002_class_cancellation.sql` — **REWRITTEN July 7, apply this version**: the
   original could not have applied cleanly because `classes.status` already existed
   (Gemini-era column, live value `'Enrolling'`). The rewrite drops any legacy check
   constraint mentioning `status` (by pattern — the old name is unknown), normalizes legacy
   values to `'open'`, pins the open/cancelled check, and adds the two enrollment columns.
3. `20260708000003_class_school_contact.sql` — `classes.counselor_id` (optional per-class
   school contact).

The pending migrations are backward-compatible with the currently deployed code; apply them
before (or immediately with) the next push.

## 2. Vercel env var

- `ADMIN_EMAILS=williamraymondthomas@gmail.com,billy@highergroundlearning.com`
  (already in `.env.local`). Comma-separated allowlist: these emails derive the admin role at
  magic-link login even before a profiles row exists. Redeploy required after setting.

## 3. Supabase Auth settings (dashboard)

- **Session lifetime** — ACCEPTED DEVIATION (July 6): the spec §2 decision was 30 days, but
  the Supabase free plan locks the session time-box at "never", so sessions don't expire on
  a schedule. Nothing to configure; revisit if the project moves to a paid Supabase plan.
  (Sessions still end on sign-out, and magic-link/OTP tokens themselves expire in 1 hour.)
- **Disable public signup** + set Site URL to `https://hgl-portal.vercel.app` (still open from
  Phase 3). Signup stays disabled: portal accounts are created lazily by
  `/api/auth/request-login` via the admin API, which bypasses the signup switch.
- **Resend SMTP in Supabase Auth is NOT needed** (deviation from spec §10, same outcome):
  login emails are generated with `auth.admin.generateLink()` and sent through the Resend API
  like every other portal email — one template carrying both the magic link and the 8-digit
  OTP, from the verified domain. Supabase's own mailer is never used.

## 4. Deploy

`git push` (deploy = push). Then smoke test:

1. `/login` → enter a parent email that exists in `families` → email arrives with button +
   code → button lands on `/portal` showing that family's students; the 8-digit code also
   works (enter it on the same screen — the project's Auth OTP length is 8, and
   `app/utils/otp.ts` must be kept in sync if that setting ever changes).
2. Unknown email → same "on its way" message, no email (no enumeration).
3. Staff: "Staff sign-in with password" toggle still works → `/admin`; admins also get an
   "Admin →" link if they open `/portal`.
4. `/portal?enrollment=<id>` signed out → login (email prefilled if `pe`/`pt` present, i.e.
   from the #0 button) → back to the highlighted enrollment card.
5. Receipt PDF button on a paid enrollment downloads with amount/date/add-on line.
6. Admin page: new **School counselors** and **Instructors** panels at the bottom;
   classroom-request status badge on in-person classes.
7. Cancellation flow (§12), best tested on a throwaway test class with a test-email
   enrollment: "Cancel class…" → offers form + per-family math preview → confirm → CX to the
   paid family (both audiences), CX-W to waitlisted, CX-C to the school contact; class shows
   the CANCELLED chip; registration page reads "This class is full" with no waitlist form;
   the ICS feed goes empty; the next hourly sweep sends nothing for the class; the outcome
   dropdown appears on paid rows.

## 5. ⚠️ Go-live email behavior (check BEFORE deploying)

The hourly sweep gains three counselor-facing sends. On the **first sweep after deploy**:

- **Classroom requests** fire immediately for any *in-person* class starting within 14 days
  that has a blank location (then re-nudges at 11 and 8 days). Set locations on any such
  classes first if you don't want counselors emailed yet.
- **Final-3-days push** fires daily for any class within 3 days of its
  `enrollment_deadline` (fallback: first session) that still has open registration — or the
  one-off "class is full 🎉" note if it's full.
- **Counselor digests** start the first **Monday ≥ 8:00 school-local** after deploy, to every
  counselor whose school has a class with open registration (default frequency: weekly). To
  hold someone back, set their digest to *Paused* in the new admin panel before Monday.

**Copy status:** the school-contact templates (CR1/CR2/CR3, CD, FP, FP-alt) carry the FINAL
approved copy from `docs/PHASE4_COUNSELOR_EMAIL_COPY.md` (v1.0, July 6). FP-alt fires instead
of the push when the PAID count reaches capacity. Only `loginLinkEmail` (parent/staff-facing,
not in that deck) remains agent-drafted.

## 6. Post-launch QA the agent can run next session (needs the migration applied)

**After EVERY migration apply: Supabase Security Advisor shows zero findings** (added July 7
after contacts/school_affiliations/instructors briefly shipped without RLS — a partial apply
separated table creation from the enable-RLS statements; 20260709000003 consolidates the
posture for those three). Rule going forward: any migration that creates a table includes
`enable row level security` + its policies **in the same file**.

Acceptance checklist from PHASE4_SPEC §11 — fixtures + verification for: second-family RLS
isolation, sibling attach on repeat parent email, counselor scope (scores+accommodations yes;
contacts/payments/notes no), digest frequency links, deadline push against a test deadline,
classroom-request form → `classes.default_location` → SU email, instructor meeting-link
fallback, seeded `student_scores` rendering in all three views (and hidden when empty).

## Open items

- Synap score ingestion method (spec §6.3): Scarlett reviewing Synap API/export docs; the
  `student_scores` display layer is live-but-dark either way.
- Phase 4.5 fast-follow: parent letter / student flyer PDFs (spec §8) — not in this build.
- **Pre-launch data reset (addendum §7):** test/joke classes, registrations, and fake people
  stay in the DB during testing. Before real launch, truncate all test data — classes,
  sessions, enrollments, families, students, add-ons, waitlist rows, email_log — and start
  fresh (established deletion order in the ops notes: email_log → enrollments/addons →
  students → classes → schools). Also drop the deprecated `school_counselors` table and the
  legacy `classes.instructor_name`/`instructor_email` columns once reads are confirmed
  switched.
