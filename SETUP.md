# HGL Portal — setup after the foundation refactor

This guide walks you through the four things you need to do to get the latest changes working:
1. Apply the database migration in Supabase
2. Set a couple of environment variables
3. Clean up `node_modules` with a fresh `npm install`
4. (If not already done) wire up the Stripe webhook

None of this is dangerous. The migration is additive — it only adds new tables and columns; it doesn't drop anything.

---

## 1. Apply the database migration

You have a new file at `supabase/migrations/20260424000001_foundation_schema.sql`. You need to run its contents against your Supabase database.

1. Open your Supabase project → **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open `supabase/migrations/20260424000001_foundation_schema.sql` in VS Code, **select all**, copy, and paste into the SQL Editor.
4. Click **Run**.

You should see a success message. Under **Table Editor** you'll now see new tables: `schools`, `school_counselors`, `sessions`. Your existing `classes`, `students`, and `enrollments` tables will have new columns added to them.

If you had any existing classes with a `school_nickname` value, the migration auto-created a matching row in `schools` and linked them up. Check it by looking at `schools` — one row per distinct nickname you had before.

---

## 2. Set environment variables

Two new env vars are needed.

### Locally (`.env.local`)

Open `.env.local` at the project root and add (or confirm) these keys:

```
NEXT_PUBLIC_SUPABASE_URL=<your supabase URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your supabase anon key>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<your stripe publishable key>
STRIPE_SECRET_KEY=<your stripe secret key>

# NEW: where the app lives. For local dev this is localhost; for production
# this should be your Vercel URL or your custom domain.
NEXT_PUBLIC_APP_URL=http://localhost:3000

# NEW: the signing secret for your Stripe webhook endpoint.
# See section 4 below for how to get this.
STRIPE_WEBHOOK_SECRET=whsec_...
```

### On Vercel

Go to **Vercel → your project → Settings → Environment Variables** and add:

- `NEXT_PUBLIC_APP_URL` = `https://hgl-portal.vercel.app` (or your custom domain like `https://portal.highergroundlearning.com` once it's set up)
- `STRIPE_WEBHOOK_SECRET` = (the `whsec_...` value from Stripe — see section 4)

Vercel will automatically redeploy once you save.

---

## 3. Clean up `node_modules`

I removed a conflicting Tailwind package from `package.json`. To sync your local install:

```bash
cd /Users/williamthomas/Desktop/hgl-portal
rm -rf node_modules package-lock.json
npm install
```

This reinstalls everything fresh. It'll take a minute.

Then start the app:

```bash
npm run dev
```

Visit http://localhost:3000 — you should see the parent-facing class list, and http://localhost:3000/admin should show the admin page with the new fields.

---

## 4. Wire up the Stripe webhook

The webhook is how Stripe tells your app "payment succeeded, mark the enrollment as Paid." Without it, enrollments stay stuck at `Pending Checkout` even after people pay.

### Production (Vercel) webhook

1. Open the **Stripe Dashboard** → **Developers** → **Webhooks**.
2. Click **Add endpoint**.
3. **Endpoint URL:** `https://hgl-portal.vercel.app/api/webhook` (or your production domain).
4. **Events to send:** select `checkout.session.completed`.
5. Click **Add endpoint**.
6. Stripe shows you a **Signing secret** (starts with `whsec_...`). Copy it.
7. Paste this value into the Vercel env var `STRIPE_WEBHOOK_SECRET` (see section 2).
8. Redeploy (Vercel does this automatically when env vars change).

### Local webhook (for testing)

If you want to test the full pay-and-mark-paid flow on your laptop:

```bash
# one-time install
brew install stripe/stripe-cli/stripe

# forward Stripe events to your local app
stripe login
stripe listen --forward-to localhost:3000/api/webhook
```

The command prints a local `whsec_...` — put that in your `.env.local` for testing. Leave the terminal running while you test a payment.

---

## What changed in this pass

Quick summary of what the foundation refactor did, in case you want to retrace my steps:

**Database (via migration file):**
- Added `schools` and `school_counselors` tables.
- Added `student_email`, `school_id`, `grade_level` to `students`.
- Added `school_id`, `instructor_email`, `default_location`, `synap_group` to `classes`.
- Added `sessions` table (per-class meeting calendar).
- Added `stripe_session_id`, `stripe_payment_intent_id`, `paid_at` to `enrollments`.
- Backfilled `schools` rows from existing `classes.school_nickname` values.

**Code:**
- `app/api/checkout/route.ts` — now passes `enrollment_id` through Stripe metadata, stamps it on the enrollment, and uses `NEXT_PUBLIC_APP_URL` for redirect URLs instead of a hardcoded Vercel domain.
- `app/api/webhook/route.ts` — matches the Stripe event to the exact enrollment (by `metadata.enrollment_id` or `stripe_session_id`), not by guessing via email. Fixes the sibling-registration bug.
- `app/register/[id]/page.tsx` — captures student email and grade, links student to the class's school, passes enrollment id to Stripe.
- `app/admin/page.tsx` — schools dropdown (auto-creates new schools), new class fields (instructor email, default location, Synap group), per-class session management (add / remove dates), roster now shows student email + payment status.
- `app/page.tsx` — reads school from the joined `schools` table, shows session count.
- `next.config.ts` — removed `ignoreBuildErrors` / `ignoreDuringBuilds` (dangerous; hid real errors).
- `package.json` — removed conflicting `@tailwindcss/postcss ^4`; repo is cleanly on Tailwind v3.
- `postcss.config.mjs` — normalized to v3 style so Next doesn't load two different configs.
- `app/layout.tsx` — fixed the default "Create Next App" metadata.

**What's not done yet (next phases):**
- Auth (Supabase Auth + Row-Level Security + parent / instructor / counselor login).
- Automated email sequences (Resend + templates tied to cohort / session dates, for both parents and students).
- Counselor and instructor dashboards.
- QuickBooks integration.
- A "course template" concept so creating a new cohort is one-click.

---

## 5. Phase 2: automated emails (Resend)

Three new env vars (add locally in `.env.local` and in Vercel → Settings → Environment Variables, ticking "Sensitive" for the secrets):

```
RESEND_API_KEY=<from resend.com → API Keys>
EMAIL_FROM=Higher Ground Learning <you@yourdomain.com>   # optional; defaults to onboarding@resend.dev
CRON_SECRET=<any long random string>                     # protects /api/cron/reminders
```

Notes:
- Until you verify a sending domain in Resend (Domains → Add → highergroundlearning.com, add their DNS records), Resend only delivers to your own account email, from `onboarding@resend.dev`. Verify the domain before real parents register.
- Emails sent automatically: registration confirmation (on Stripe payment), "class starts in 3 days," and "session tomorrow" reminders. The last two run from a daily Vercel Cron (8am Mexico City, see `vercel.json`). Every send is recorded in the `email_log` table, which also guarantees nobody is ever emailed twice for the same thing.
- Emails go to the parent and, when provided, the student's email.
