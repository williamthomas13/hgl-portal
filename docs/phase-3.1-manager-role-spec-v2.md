# Phase 3.1 (v2) — Manager Role Spec

**Status:** Approved. Refunds decision resolved: **Option A** (see §4).
**Goal:** Add a `manager` role for staff who run daily operations. Managers can do nearly everything in the admin area. The `admin` role is reserved for ownership-level control.

## 1. The permission boundary

**Manager CAN (everything operational):**
- Create/edit/delete classes, sessions, slugs, enrollment deadlines, capacity, min-enrollment
- Manage schools and school_counselors
- Create/edit enrollments, change enrollment status, manage waitlists (offer spots, handle rollovers)
- Mark paid enrollments as Refunded (see §4 — no money movement in the portal)
- Edit tutoring packages and pricing
- Trigger/resend emails, view send status, resolve hold-and-alert flags
- View everything admins view

**Manager CANNOT (ownership-level):**
- Read, change, or assign anyone's `role` in `profiles` — including their own (privilege escalation is the #1 thing this role exists to prevent)
- Create or delete Auth users
- Run schema/config changes of any kind
- Access or manage environment secrets, Stripe keys, webhook config (mostly enforced by these living in Vercel/Stripe/Supabase dashboards — see §5)
- Delete rows with financial history: enrollments that have a `stripe_payment_intent_id`, and enrollment_addons, are edit-only, never deletable (protects the audit trail feeding Phase 6 / QuickBooks)
- Hard-delete families/students that have any paid enrollment (soft-disable is fine)

## 2. Schema

New migration (do not edit `20260707000003`):
- Add `'manager'` to the `profiles.role` set (values: admin, manager, instructor, counselor, parent). Signup-trigger default stays `parent`.
- Add `'Refunded'` to the enrollment status enum (alongside Pending / Paid / Completed / Expired / Waitlisted).

## 3. RLS + route enforcement

- Introduce `is_staff()` = admin OR manager. Convert existing admin CRUD policies to `is_staff()` for all operational tables (families, students, schools, school_counselors, classes, sessions, enrollments, enrollment_addons, tutoring_packages).
- `profiles`: SELECT own row only for managers; all INSERT/UPDATE/DELETE on profiles remains `is_admin()` only. Verify there is no path for a manager to UPDATE `profiles.role`.
- DELETE restrictions per §1 (paid enrollments / addons; families/students with paid history) as RLS conditions and/or route-level guards.
- **Route audit (critical):** all mutating API routes run on the service-role client, which bypasses RLS — so every route needs a server-side role check. Operational routes check `is_staff`; anything touching profiles/roles/user-management checks `admin`. Public routes (`/api/class-info`, `/api/register`, `/api/checkout`, webhook, cron) unchanged.
- `proxy.ts` + `admin/layout.tsx`: admit admin and manager.

## 4. Refunds — Option A (resolved)

- **No refund logic or Stripe API refund calls in the portal.** Money movement happens in the Stripe dashboard only.
- A manager (or admin) can set a paid enrollment's status to `Refunded` in the portal. Setting it:
  - frees the capacity spot and triggers the normal waitlist W2 flow, same as expiry;
  - keeps `stripe_payment_intent_id` and all payment history intact on the row (never deleted, per §1);
  - excludes the enrollment from paid counts and from post-class emails (#7/#8);
  - suppresses any still-pending scheduled sends for that enrollment.
- SPEC §13 note: actual refunds are issued in the Stripe dashboard; the manager's Stripe access should be a "Support Specialist" role there (configured by Scarlett in Stripe, not in code).

## 5. Things code can't enforce (owner checklist — record in SPEC §13)

- Vercel: manager gets no Vercel account access
- Supabase dashboard: no access (dashboard access = service key access = everything)
- Stripe: separate Stripe "Support Specialist" role per §4
- GitHub repo: not required for this role

## 6. UI

- Manager sees the full admin UI. Hide only the ownership bits: any user/role management surface; disable delete buttons on paid enrollments/addons with a tooltip ("has payment history"). "Manager" badge in header.
- Server-render the role into the layout so the UI can't be trivially toggled client-side (defense in depth — the route-level 403s in §3 are the real barrier).

## 7. Smoke checklist

- Manager: full class/session/school/enrollment/waitlist/package CRUD works
- Manager: marking a paid enrollment Refunded frees the spot, fires W2 when a waitlist exists, suppresses pending sends, and keeps payment fields intact
- Manager: cannot see or edit any profile role; attempts → 403
- Manager: cannot delete a paid enrollment or addon → 403/blocked
- Manager: cannot create/delete auth users
- Refunded enrollments excluded from paid counts and from #7/#8
- Admin behavior unchanged; parent/instructor/counselor still blocked from `/admin`
- Sign in as manager and confirm no role-management UI is rendered

## 8. Docs & ops

- Bump spec to v2.5. Roles list becomes: **admin** (ownership: roles, users, config) · **manager** (operations: everything else, incl. marking refunds) · instructor / counselor / parent (Phase 4 read scopes).
- Document manager creation: admin creates the user in Supabase Auth (dashboard → Authentication → Users → Add user; works with public signup disabled), then `update profiles set role='manager' where email='...'`.
