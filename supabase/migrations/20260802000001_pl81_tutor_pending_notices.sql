-- PL-81: T3-T stays mandatory — coalesce rapid changes per tutor instead.
-- A session change arms (or slides) ONE pending notice per tutor:
--   send_after = now + 45 min, capped at first_change_at + 3 h.
-- Urgent changes (a touched session starting within 24 h, old or new time)
-- deliver immediately, folding whatever else is pending. Delivery: hourly
-- cron sweep + the inline due-pass at record time. Calendar updates stay
-- instant and unconditional — only the email coalesces. Idempotent.

create table if not exists public.tutor_pending_notices (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.instructors(id) on delete cascade,
  -- array of change objects: {sessionId, kind, notice, studentId,
  -- studentFirst, subjectName, oldStartsAt, newStartsAt, recordedAt}
  changes jsonb not null default '[]'::jsonb,
  first_change_at timestamptz not null default now(),
  send_after timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open batch per tutor — concurrent recorders fold into the same row.
create unique index if not exists tutor_pending_notices_one_pending
  on public.tutor_pending_notices (tutor_id) where status = 'pending';

create index if not exists tutor_pending_notices_due
  on public.tutor_pending_notices (send_after) where status = 'pending';

alter table public.tutor_pending_notices enable row level security;

-- Staff read/manage; the send paths write via the service role.
drop policy if exists "staff all" on public.tutor_pending_notices;
create policy "staff all" on public.tutor_pending_notices
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

notify pgrst, 'reload schema';
