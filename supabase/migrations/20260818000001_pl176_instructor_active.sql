-- PL-176: "Remove" becomes "Make inactive" — instructors who may return are
-- hidden from active pickers/rosters with history intact, never deleted.
-- Idempotent.
alter table public.instructors
  add column if not exists active boolean not null default true;

comment on column public.instructors.active is
  'PL-176: false = hidden from new scheduling pickers and the instructor list''s Active tab; history (sessions, timecards, classes) untouched. Reversible.';
