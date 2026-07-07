-- =============================================================================
-- HGL Portal: RLS enforcement for contacts, school_affiliations, instructors
-- =============================================================================
-- Follow-up to the July 7 addendum ship: Security Advisor flagged these three
-- tables as publicly accessible via the anon key — the enable-RLS statements
-- lived in the same files as the table creation (0001/0002 + phase4 portal)
-- but a partial apply left a window where the tables existed unprotected.
-- This file makes the security posture of all three tables a single
-- self-contained, re-runnable artifact.
--
-- Posture (consistent with Phase 3):
--   * anon: NO policies on any of the three tables — zero access. Public
--     pages never query them client-side; they get sanitized payloads from
--     /api/* routes running as service_role (bypasses RLS, does its own
--     explicit checks). The instructor default-meeting-link flows into
--     classes.default_location at creation, so the register page needs no
--     instructors read.
--   * authenticated staff (admin/manager): full CRUD via is_staff() — this is
--     what the /admin panels, wizard, and dropdowns use (the browser client
--     carries the signed-in cookie session, so those queries run as
--     `authenticated`, not anon).
--   * authenticated self-reads: a contact sees their own contacts row and
--     their own affiliations (portal role detection + counselor view); an
--     instructor sees their own instructors row (instructor view).
--
-- PROCESS RULE (this incident): every future migration that creates a table
-- must include ENABLE ROW LEVEL SECURITY + its policies IN THE SAME FILE,
-- and "Security Advisor shows zero findings" is part of the post-migration
-- checklist.
--
-- IDEMPOTENT: enable-RLS is a no-op when already on; policies drop-then-create.
-- =============================================================================

alter table public.contacts enable row level security;
alter table public.school_affiliations enable row level security;
alter table public.instructors enable row level security;

-- contacts ---------------------------------------------------------------
drop policy if exists "staff all" on public.contacts;
create policy "staff all" on public.contacts
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "contact self" on public.contacts;
create policy "contact self" on public.contacts
  for select to authenticated
  using (lower(email) = public.jwt_email());

-- school_affiliations -----------------------------------------------------
drop policy if exists "staff all" on public.school_affiliations;
create policy "staff all" on public.school_affiliations
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "own affiliations" on public.school_affiliations;
create policy "own affiliations" on public.school_affiliations
  for select to authenticated
  using (contact_id in (select public.contact_ids()));

-- instructors --------------------------------------------------------------
drop policy if exists "staff all" on public.instructors;
create policy "staff all" on public.instructors
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "instructor self" on public.instructors;
create policy "instructor self" on public.instructors
  for select to authenticated
  using (lower(email) = public.jwt_email());

-- PostgREST: pick up the policy changes
notify pgrst, 'reload schema';
