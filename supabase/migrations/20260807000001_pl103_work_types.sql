-- PL-103/PL-104: work-type attribution for timecards.
--
-- The paper timecard's columns (Test Prep · 1-on-1 · 2-on-1 · Prep Time ·
-- Class/Workshop · Other) become per-session work types, and group-class
-- sessions taught gain a pay path onto the instructor's timecard.
-- TITLES ONLY, NO AMOUNTS: pay rates live in QBO Payroll and never enter
-- the portal (Scarlett, Jul 23).
--
-- Idempotent: safe to re-run.

-- Tutoring sessions carry a work type; null = the base 1-on-1 default.
alter table public.tutoring_sessions
  add column if not exists work_type text;

-- Class-schedule sessions can be stamped onto a timecard, mirroring
-- tutoring_sessions.timecard_id. Always attributed as Class/Workshop.
alter table public.sessions
  add column if not exists timecard_id uuid references public.timecards(id) on delete set null;
create index if not exists sessions_timecard_id_idx on public.sessions (timecard_id);

-- PL-104: the tutor's QBO pay-type TITLE list (base pay = 1-on-1/Test Prep
-- is implicit; this holds the named extras like "chem prep").
alter table public.instructors
  add column if not exists pay_type_titles text[] not null default '{}';
