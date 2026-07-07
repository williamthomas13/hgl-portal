# Phase 4 launch runbook

Code is complete and building (`next build` clean, eslint clean). The steps below are the ones
the agent could not do (prod DDL / Vercel env / Supabase dashboard are approval-gated), in
order, plus go-live behavior you should know about **before** deploying.

## 1. Apply BOTH migrations, in order (before deploying the code)

1. `supabase/migrations/20260708000001_phase4_portal.sql` — adds `student_scores`,
   `instructors`, `classroom_requests`, and `school_counselors.digest_frequency` /
   `digest_last_sent_at`, all with RLS policies.
2. `supabase/migrations/20260708000002_class_cancellation.sql` — adds `classes.status`
   (open | cancelled), `enrollments.class_cancelled`, `enrollments.cancellation_outcome`
   (§12 cancellation flow).

Both are backward-compatible with the currently deployed Phase 3.1 code (new tables/columns
are simply unused), so apply them first. The new code **fails without them** (`/portal`, the
sweep, and the admin page all read the new columns), so do not deploy first. Run them in the
Supabase SQL editor (or approve the management-API calls in an interactive session).

## 2. Vercel env var

- `ADMIN_EMAILS=williamraymondthomas@gmail.com,billy@highergroundlearning.com`
  (already in `.env.local`). Comma-separated allowlist: these emails derive the admin role at
  magic-link login even before a profiles row exists. Redeploy required after setting.

## 3. Supabase Auth settings (dashboard)

- **Session lifetime 30 days** (spec §2 decision): Authentication → Sessions — set refresh
  token / session time-box to 30 days. JWT expiry can stay at the default.
- **Disable public signup** + set Site URL to `https://hgl-portal.vercel.app` (still open from
  Phase 3). Signup stays disabled: portal accounts are created lazily by
  `/api/auth/request-login` via the admin API, which bypasses the signup switch.
- **Resend SMTP in Supabase Auth is NOT needed** (deviation from spec §10, same outcome):
  login emails are generated with `auth.admin.generateLink()` and sent through the Resend API
  like every other portal email — one template carrying both the magic link and the 6-digit
  OTP, from the verified domain. Supabase's own mailer is never used.

## 4. Deploy

`git push` (deploy = push). Then smoke test:

1. `/login` → enter a parent email that exists in `families` → email arrives with button +
   code → button lands on `/portal` showing that family's students; the 6-digit code also
   works (enter it on the same screen).
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

Acceptance checklist from PHASE4_SPEC §11 — fixtures + verification for: second-family RLS
isolation, sibling attach on repeat parent email, counselor scope (scores+accommodations yes;
contacts/payments/notes no), digest frequency links, deadline push against a test deadline,
classroom-request form → `classes.default_location` → SU email, instructor meeting-link
fallback, seeded `student_scores` rendering in all three views (and hidden when empty).

## Open items

- Synap score ingestion method (spec §6.3): Scarlett reviewing Synap API/export docs; the
  `student_scores` display layer is live-but-dark either way.
- Phase 4.5 fast-follow: parent letter / student flyer PDFs (spec §8) — not in this build.
