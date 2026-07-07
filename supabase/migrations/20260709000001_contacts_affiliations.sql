-- =============================================================================
-- HGL Portal: contacts + school_affiliations (admin UX addendum, July 7)
-- =============================================================================
-- Replaces school_counselors with two tables:
--   contacts            — the person (name, email, phone). One row per human.
--   school_affiliations — the person's tenure at a school (contact_id,
--                         school_id, role, started_at, ended_at; null ended_at
--                         = current). Digest subscription + frequency hang off
--                         the AFFILIATION, not the contact — a counselor who
--                         changes schools keeps their contact row and gets a
--                         fresh affiliation with fresh digest prefs.
--
-- Counselor auth attaches to the contact's email; RLS scopes through ACTIVE
-- affiliations only (counselor_school_ids below), so ending an affiliation
-- ends portal access and digests without deleting anyone's history.
--
-- Data migration: each school_counselors row becomes one contact + one open
-- affiliation. Ids are PRESERVED on both new rows:
--   * contacts.id = school_counselors.id → classes.counselor_id values stay
--     valid across the FK repoint (contacts is now the referenced table).
--   * school_affiliations.id = school_counselors.id → digest-frequency tokens
--     in already-delivered digest emails (HMAC over the row id) keep working.
--
-- school_counselors is KEPT (deprecated, unread) until the pre-launch cleanup
-- runbook drops it — same pattern as classes.school_nickname.
--
-- IDEMPOTENT: safe to re-run; creates are guarded, policies drop-then-create,
-- constraint repoint drops before adding, backfills skip existing rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text unique not null,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.school_affiliations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  role text not null default 'counselor',
  started_at date not null default current_date,
  ended_at date,                       -- null = current affiliation
  digest_frequency text not null default 'weekly'
    check (digest_frequency in ('weekly', 'biweekly', 'monthly', 'paused')),
  digest_last_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_school_affiliations_contact_id
  on public.school_affiliations(contact_id);
create index if not exists idx_school_affiliations_school_id
  on public.school_affiliations(school_id);
-- Most reads are "active affiliations only".
create index if not exists idx_school_affiliations_active
  on public.school_affiliations(school_id, contact_id) where ended_at is null;

-- -----------------------------------------------------------------------------
-- 2. Data migration from school_counselors (id-preserving, re-runnable)
-- -----------------------------------------------------------------------------
insert into public.contacts (id, first_name, last_name, email, phone, created_at)
select id, first_name, last_name, email, phone, created_at
  from public.school_counselors
on conflict do nothing;

insert into public.school_affiliations
  (id, contact_id, school_id, role, started_at, digest_frequency, digest_last_sent_at, created_at)
select sc.id, sc.id, sc.school_id, 'counselor', sc.created_at::date,
       sc.digest_frequency, sc.digest_last_sent_at, sc.created_at
  from public.school_counselors sc
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. Repoint classes.counselor_id → contacts (values already valid: ids match)
-- -----------------------------------------------------------------------------
alter table public.classes drop constraint if exists classes_counselor_id_fkey;
alter table public.classes
  add constraint classes_counselor_id_fkey
  foreign key (counselor_id) references public.contacts(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 4. RLS helpers: counselor scope now flows through ACTIVE affiliations
-- -----------------------------------------------------------------------------
-- Contact rows owned by the signed-in email (security definer: policies on
-- school_affiliations use it without recursing through contacts RLS).
create or replace function public.contact_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select id from public.contacts
  where lower(email) = public.jwt_email()
$$;

-- Schools this counselor belongs to — REDEFINED from school_counselors to
-- active affiliations. Every counselor policy (students, enrollments,
-- student_scores, can_view_class) picks this up without being rewritten.
create or replace function public.counselor_school_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select sa.school_id
    from public.school_affiliations sa
    join public.contacts ct on ct.id = sa.contact_id
   where lower(ct.email) = public.jwt_email()
     and sa.ended_at is null
$$;

-- Counselor clause now routes through counselor_school_ids() (active
-- affiliations) instead of joining the deprecated school_counselors.
create or replace function public.can_view_class(cid uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.classes c
      where c.id = cid and lower(c.instructor_email) = public.jwt_email()
    )
    or exists (
      select 1 from public.classes c
      where c.id = cid and c.school_id in (select public.counselor_school_ids())
    )
    or exists (
      select 1 from public.enrollments e
      join public.students s on s.id = e.student_id
      join public.families f on f.id = s.family_id
      where e.class_id = cid and lower(f.parent_email) = public.jwt_email()
    )
$$;

grant execute on function public.contact_ids() to authenticated, anon;

-- -----------------------------------------------------------------------------
-- 5. RLS policies on the new tables
-- -----------------------------------------------------------------------------
alter table public.contacts enable row level security;
alter table public.school_affiliations enable row level security;

drop policy if exists "staff all" on public.contacts;
create policy "staff all" on public.contacts
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "contact self" on public.contacts;
create policy "contact self" on public.contacts
  for select to authenticated
  using (lower(email) = public.jwt_email());

drop policy if exists "staff all" on public.school_affiliations;
create policy "staff all" on public.school_affiliations
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "own affiliations" on public.school_affiliations;
create policy "own affiliations" on public.school_affiliations
  for select to authenticated
  using (contact_id in (select public.contact_ids()));

-- -----------------------------------------------------------------------------
-- 6. Deprecate the old table (dropped in the pre-launch cleanup runbook)
-- -----------------------------------------------------------------------------
comment on table public.school_counselors is
  'DEPRECATED (July 2026): replaced by contacts + school_affiliations. '
  'Kept unread for rollback safety; drop in the pre-launch cleanup runbook.';

-- PostgREST: pick up the new tables + redefined functions
notify pgrst, 'reload schema';
