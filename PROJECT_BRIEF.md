# HGL Portal — Project Brief

Context for anyone (human or AI) picking up work on the Higher Ground Learning custom portal. Copy this into a Claude Project's knowledge / custom instructions so future conversations don't have to re-derive it.

---

## The business

Higher Ground Learning is a tutoring / test-prep / group-classes business. Three main offerings:

- **Group classes** (school-specific SAT/ACT prep and similar cohorts). Highest-pain workflow — the one this portal exists to fix.
- **1-on-1 tutoring** (currently in TutorBird).
- **Test prep / practice** (currently in Synap).

Public site is on Squarespace at `highergroundlearning.com`. Accounting/payroll runs on QuickBooks Online. Team collaboration on Google Workspace. Email marketing on MailerLite. Zapier stitches things together.

## The problem this portal is solving

Running a new group class today requires manually:

1. Building a calendar in Google Sheets and exporting it as an image.
2. Creating a Squarespace landing page with that image.
3. Embedding a MailerLite form as a "registration form."
4. Creating a Squarespace shop page to actually collect payment (people frequently think they're registered after the form and don't pay).
5. Building a Zapier automation that catches paid customers from Squarespace and adds them to a MailerLite email sequence with hand-edited dates and details for that specific class.
6. Someone at HGL manually copying registration info to a separate spreadsheet to track capacity.
7. Emailing counselors on demand with enrollment counts because they can't see it themselves.

Because MailerLite uses one email address and Squarespace payment uses another (parents often mismatch), Zapier can't always match records — creating manual reconciliation work. Emails only go to parents (MailerLite limitation), not to students. Every class at every school means rebuilding the calendar + landing page + payment page + email automations from scratch.

## Strategy

Custom portal at `portal.highergroundlearning.com` (subdomain of the existing Squarespace site) that absorbs Arlo + TutorBird + MailerLite + Zapier for group classes first. Keep Squarespace as the marketing front. Keep QuickBooks (never build accounting). Keep Google Workspace. Keep Synap for now, integrate later.

## Tech stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **Styling:** Tailwind CSS v3
- **Database + auth:** Supabase (Postgres)
- **Payments:** Stripe (Sandbox / test mode currently)
- **Hosting:** Vercel (`hgl-portal.vercel.app`)
- **Repo location on Scarlett's Mac:** `/Users/williamthomas/Desktop/hgl-portal`

## Data model (current)

- `families` — one row per billing parent (unique by email).
- `students` — belong to a family; have `student_email`, optional `school_id`, `grade_level`.
- `schools` — proper entity; each has a `nickname` (unique), name, contact email.
- `school_counselors` — belong to schools; have their own email.
- `classes` — one row per school-specific cohort. Fields: `school_id` FK, `class_type`, `instructor_name`, `instructor_email`, `price`, `capacity`, `start_date`, `default_location`, `synap_group`. Also carries a legacy `school_nickname` text for backward compat (to be dropped later).
- `sessions` — the class meeting calendar. Each row is one meeting: `class_id` FK, `session_date`, `start_time`, `end_time`, `location`.
- `enrollments` — bridges a student to a class. Fields: `payment_status` (`Pending Checkout` / `Paid`), `enrolled_at`, `paid_at`, `stripe_session_id`, `stripe_payment_intent_id`.

Row-Level Security is intentionally NOT enabled yet — deferred to the auth phase. Anon key currently reads/writes everything. Don't share the anon key publicly until Phase 3.

## Foundation phase — what's done

The database has a proper `schools` table with a companion `school_counselors` table, a `sessions` table for per-class meeting calendars, `student_email` + `school_id` + `grade_level` on students, `instructor_email` + `default_location` + `synap_group` + a real `school_id` FK on classes, and `stripe_session_id` + `stripe_payment_intent_id` + `paid_at` on enrollments so Stripe events can be matched to the exact enrollment they belong to.

The Stripe webhook bug (siblings registering back-to-back could get mismarked) is fixed by passing `enrollment_id` through Stripe metadata. The registration page captures student email and grade. The admin page has a schools-suggestions dropdown, all the new class fields, and per-class session management (add/remove dates with location and times). The dangerous "ignore all build errors" flags are off, the conflicting Tailwind versions are resolved, and the hardcoded Vercel URL in the checkout redirect is driven by `NEXT_PUBLIC_APP_URL`. TypeScript and ESLint pass clean.

The migration SQL that produced this schema lives at `supabase/migrations/20260424000001_foundation_schema.sql`.

## Key files

- `app/page.tsx` — parent-facing class list.
- `app/register/[id]/page.tsx` — registration + payment handoff.
- `app/admin/page.tsx` — admin: create class, manage sessions, view rosters.
- `app/api/checkout/route.ts` — Stripe Checkout session creation.
- `app/api/webhook/route.ts` — Stripe webhook, marks enrollment paid.
- `app/utils/supabase.ts` — Supabase client (anon key).
- `app/utils/stripe.ts` — Stripe.js client (publishable key).
- `supabase/migrations/*.sql` — schema changes over time.
- `SETUP.md` — one-time setup steps (migration + env vars + webhook + install).

## Environment variables

Local (`.env.local`) and Vercel both need:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_APP_URL` (local: `http://localhost:3000`; production: `https://hgl-portal.vercel.app` or the eventual `portal.highergroundlearning.com`)

Stripe webhook endpoint in Sandbox: `https://hgl-portal.vercel.app/api/webhook` listening to `checkout.session.completed`.

## Roadmap

**Phase 2 — Automated emails.** MailerLite/Zapier killer. Wire in Resend, create templates for registration confirmation, "class starts in 3 days," Synap access, per-session reminders. Emails are tied to real session dates in the DB so no more manual date editing. Send to both parent and student. Highest-leverage remaining phase.

**Phase 3 — Auth and access control.** Supabase Auth + real login + roles (admin / instructor / counselor / parent) + Row-Level Security policies. Counselors see only their school's students, parents see only their family's data. Must happen before the URL goes public.

**Phase 4 — The three portal views.** Instructor view of "my classes and rosters," counselor view of "my school's students and their enrollments," parent view of "my kids' classes, session schedule, and receipts."

**Phase 5 — Course templates.** A `courses` table so "HGL SAT Prep" becomes a reusable template you clone into a school-specific cohort in one click.

**Phase 6 — QuickBooks integration.** Wire successful Stripe payments to push revenue records into QuickBooks Online via their API. Kills the last piece of manual accounting reconciliation for group classes.

**Later, each a mini-project:** replace TutorBird for 1-on-1 tutoring, integrate Synap so tests auto-link to enrolled students, set up the `portal.highergroundlearning.com` subdomain from Squarespace.

## Housekeeping items

- Rotate `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` and re-add them to Vercel with the "Sensitive" checkbox ticked (clears the yellow "Needs Attention" flag).
- Once auth is in, enable RLS on all tables with role-based policies.
- Drop the legacy `classes.school_nickname` column after confirming all reads use `schools.nickname`.

## How to test locally

1. `cd /Users/williamthomas/Desktop/hgl-portal && npm run dev`
2. Open http://localhost:3000/admin, create a school+class with a couple of sessions.
3. Open http://localhost:3000/, click Register, use fake info + Stripe test card `4242 4242 4242 4242` (any future expiry, any CVC).
4. In Supabase Table Editor, verify the `enrollments` row is now `payment_status: Paid` with `stripe_session_id` and `paid_at` populated.
