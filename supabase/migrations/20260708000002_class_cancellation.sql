-- =============================================================================
-- HGL Portal: Phase 4 — class cancellation flow (PHASE4_SPEC §12)
-- =============================================================================
-- REWRITTEN July 7 before first application: classes.status ALREADY EXISTS
-- (Gemini-era column, live rows carry 'Enrolling'), so the original
-- add-column-with-check version would have skipped the column and never
-- established the open/cancelled semantics. Nothing in the app ever read the
-- legacy values, so this normalizes them: 'cancelled' is the only special
-- value, everything else becomes 'open'.
--
-- IDEMPOTENT: every statement here is safe to re-run (the constraint is
-- dropped by pattern before being re-added; a 'cancelled' status set by the
-- app is preserved by the normalizing update). Re-running the whole
-- migration set 0001→0002→0003 in order must never error.
--
-- enrollments.class_cancelled: Paid enrollments keep their status when the
-- class is cancelled (refunds stay manual in Stripe) but carry this flag.
-- enrollments.cancellation_outcome: how the family chose to resolve it —
-- bookkeeping recorded by the admin after the email conversation, not a
-- Stripe automation.
--
-- No RLS changes: staff already have UPDATE on classes/enrollments; the
-- cancellation itself runs server-side (staff-authenticated API route using
-- the service role) so status + expiries + emails move together.
-- =============================================================================

-- 1. Normalize the legacy status column to the Phase 4 semantics.
-- First drop ANY existing check constraint that mentions status, whatever the
-- Gemini era named it — otherwise the normalizing UPDATE below could violate
-- a legacy value list and roll the whole transaction back.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.classes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.classes drop constraint %I', r.conname);
  end loop;
end $$;

update public.classes set status = 'open'
 where status is distinct from 'cancelled';

alter table public.classes alter column status set default 'open';
alter table public.classes alter column status set not null;

alter table public.classes add constraint classes_status_check
  check (status in ('open', 'cancelled'));

-- 2. Cancellation bookkeeping on enrollments.
alter table public.enrollments
  add column if not exists class_cancelled boolean not null default false;

alter table public.enrollments
  add column if not exists cancellation_outcome text
  check (cancellation_outcome in ('refunded', 'converted', 'credited'));

-- PostgREST: pick up the new columns
notify pgrst, 'reload schema';
