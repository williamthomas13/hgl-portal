-- PL-219 v1.5: the structured post-class survey (the report's missing
-- input). One survey, two channels, NO login for either:
--   in_class — class-level tokenized link/QR; ALWAYS anonymous by structure
--              (student_id is never written on this channel — a roster
--              picker invites wrong-name pranks and leaks classmate names).
--   email    — per-student pre-bound link (the only named channel); a
--              "submit anonymously" checkbox discards the link at
--              submission — only the responded-bit on the enrollment
--              survives (for reminder suppression). Admin genuinely cannot
--              see who.
-- Context is never asked: the token carries the class; school, instructor,
-- and class type derive server-side. Idempotent.

create table if not exists public.class_survey_responses (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  -- null = anonymous (every in_class row, and email rows that chose it)
  student_id uuid references public.students(id) on delete set null,
  channel text not null check (channel in ('in_class', 'email')),
  satisfaction int check (satisfaction between 1 and 5),
  recommend int check (recommend between 1 and 5),
  instructor_rating int check (instructor_rating between 1 and 5),
  most_useful text,
  submitted_at timestamptz not null default now()
);

create index if not exists class_survey_responses_class_idx
  on public.class_survey_responses (class_id);

alter table public.class_survey_responses enable row level security;

-- Staff read in the portal; all writes go through the tokenized API under
-- the service role. Instructor/counselor access happens via the report
-- (service role behind an explicit role check), never direct table reads.
do $$ begin
  create policy "staff read" on public.class_survey_responses
    for select to authenticated using (public.is_staff());
exception when duplicate_object then null; end $$;

-- The responded-bit: suppresses the reminder without identifying the
-- response (set even for anonymous email submissions).
alter table public.enrollments
  add column if not exists survey_responded_at timestamptz;
