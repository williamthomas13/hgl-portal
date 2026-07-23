-- PL-112: substitute coverage requests.
--
-- A tutor asks a subject-qualified colleague to cover one session. The
-- request is offered to ONE candidate at a time (accept/decline); on accept
-- the session's tutor_id flips to the substitute (pay, calendar, and the
-- PL-111 note-history read all follow from that single fact). Matching is
-- subject-qualification ONLY — the admin fit/style notes (tutor_notes) are
-- never part of this flow. Idempotent: safe to re-run.

create table if not exists public.coverage_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  requesting_tutor_id uuid not null references public.instructors(id) on delete cascade,
  candidate_tutor_id uuid not null references public.instructors(id) on delete cascade,
  note text,
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'declined', 'cancelled')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coverage_requests_session_idx on public.coverage_requests (session_id);
create index if not exists coverage_requests_candidate_idx on public.coverage_requests (candidate_tutor_id);

alter table public.coverage_requests enable row level security;

drop policy if exists "admin all" on public.coverage_requests;
create policy "admin all" on public.coverage_requests
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Tutors read requests they are on either side of (writes go through the
-- portal API under service role, which re-checks ownership).
drop policy if exists "tutor read own" on public.coverage_requests;
create policy "tutor read own" on public.coverage_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.instructors i
      where (i.id = requesting_tutor_id or i.id = candidate_tutor_id)
        and lower(i.email) = public.jwt_email()
    )
  );
