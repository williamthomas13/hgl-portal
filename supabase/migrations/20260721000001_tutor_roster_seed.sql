-- =============================================================================
-- HGL Portal — PL-35/PL-35a/PL-44: tutor roster + subject taxonomy seed
-- (docs/TUTOR_ROSTER_SEED.md, July 19 rev — asterisk semantics confirmed)
-- =============================================================================
-- * subjects: real taxonomy replaces the coarse 7a entries (category drives
--   QBO item mapping: test_prep → 408-1, subject_tutoring → 401 at cutover).
--   Coarse entries are DEACTIVATED, not deleted (engagement FKs stay valid).
--   ASVAB + College Essays stay active: real offerings, not coarse buckets.
-- * instructors.subjects_with_prep (§1a): subjects the tutor CAN teach but
--   must not be auto-scheduled into — Kelsie confirms with the tutor (or
--   sends material) first. Disjoint from `subjects` (the ready set): the
--   wizard only auto-ranks tutors by the ready set.
-- * 19 tutors created with tutoring_active=false (Scarlett: rollout stays
--   gated per tutor; creating these rows sends no email and pushes nothing
--   to any calendar — plain inserts, no app-side create flow involved).
--   Billy Thomas exists: profile update only, tutoring flag untouched.
-- * PL-44: the existing 'Gwendolyn' row's misspelled email is fixed IN
--   PLACE (gwen@highergroundleaning.com → gwen@highergroundlearning.com),
--   then the upsert reconciles her profile — never a duplicate row.
-- * Zoom links are live rooms with embedded passwords, deliberately
--   committed (see TUTOR_ROSTER_SEED.md §2b — that doc + this file are the
--   places to update if HGL rotates them).
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

alter table public.instructors
  add column if not exists subjects_with_prep text[] not null default '{}';

comment on column public.instructors.subjects_with_prep is
  'PL-35a: subjects this tutor is capable of but should NOT be auto-scheduled '
  'into (source-sheet asterisks) — needs a heads-up or prep material first. '
  'Disjoint from subjects (the ready, auto-matchable set).';

-- 1. Subject taxonomy — upsert keeps any staff-edited hourly_rate.
insert into public.subjects (name, category, hourly_rate) values
  ('SAT', 'test_prep', 110),
  ('SAT Subject Tests', 'test_prep', 110),
  ('PSAT', 'test_prep', 110),
  ('ACT', 'test_prep', 110),
  ('ACT Writing', 'test_prep', 110),
  ('GRE', 'test_prep', 110),
  ('GED', 'test_prep', 110),
  ('GMAT', 'test_prep', 110),
  ('Praxis', 'test_prep', 110),
  ('MCAT', 'test_prep', 110),
  ('ISEE', 'test_prep', 110),
  ('SSAT', 'test_prep', 110),
  ('LSAT', 'test_prep', 110),
  ('Arithmetic', 'subject_tutoring', 75),
  ('Geometry', 'subject_tutoring', 75),
  ('Pre-Algebra', 'subject_tutoring', 75),
  ('Algebra 1', 'subject_tutoring', 75),
  ('Algebra 2', 'subject_tutoring', 75),
  ('Pre-Calculus', 'subject_tutoring', 75),
  ('Calculus', 'subject_tutoring', 75),
  ('AP/IB Calculus', 'subject_tutoring', 75),
  ('Trigonometry', 'subject_tutoring', 75),
  ('Statistics', 'subject_tutoring', 75),
  ('Earth Science', 'subject_tutoring', 75),
  ('Health & Nutrition', 'subject_tutoring', 75),
  ('Biology', 'subject_tutoring', 75),
  ('Biology Honors', 'subject_tutoring', 75),
  ('Chemistry', 'subject_tutoring', 75),
  ('Chemistry Honors', 'subject_tutoring', 75),
  ('Physics', 'subject_tutoring', 75),
  ('AP/IB Physics', 'subject_tutoring', 75),
  ('Computer Science', 'subject_tutoring', 75),
  ('Anatomy', 'subject_tutoring', 75),
  ('Grammar', 'subject_tutoring', 75),
  ('Essays', 'subject_tutoring', 75),
  ('Creative Writing', 'subject_tutoring', 75),
  ('Reading', 'subject_tutoring', 75),
  ('Literature', 'subject_tutoring', 75),
  ('World Literature', 'subject_tutoring', 75),
  ('Literary Theory', 'subject_tutoring', 75),
  ('Study Skills', 'subject_tutoring', 75),
  ('ESL', 'subject_tutoring', 75),
  ('Spanish', 'subject_tutoring', 75),
  ('French', 'subject_tutoring', 75),
  ('Italian', 'subject_tutoring', 75),
  ('German', 'subject_tutoring', 75),
  ('Latin', 'subject_tutoring', 75),
  ('Japanese', 'subject_tutoring', 75),
  ('Chinese', 'subject_tutoring', 75),
  ('Geography', 'subject_tutoring', 75),
  ('US History', 'subject_tutoring', 75),
  ('World History', 'subject_tutoring', 75),
  ('European History', 'subject_tutoring', 75),
  ('Psychology', 'subject_tutoring', 75),
  ('Political Science', 'subject_tutoring', 75)
on conflict (name) do update set category = excluded.category, active = true;

-- Retire the coarse 7a buckets (hidden from pickers; FKs intact).
update public.subjects set active = false where name in ('Math', 'Science', 'English', 'History', 'Foreign Language', 'AP Class Support', 'Other Subject');

-- 2. PL-44 first: fix Gwendolyn's misspelled email in place (skip if the
--    corrected address already exists as its own row).
update public.instructors set email = 'gwen@highergroundlearning.com'
  where lower(email) = 'gwen@highergroundleaning.com'
    and not exists (select 1 from public.instructors where lower(email) = 'gwen@highergroundlearning.com');

-- 3. Roster upsert. New rows: tutoring OFF. Existing rows (Billy, Gwen):
--    profile refreshed, tutoring_active / google_calendar_id / offer_windows
--    untouched; a seeded meeting link wins, a blank one keeps what's there.
insert into public.instructors (email, name, timezone, subjects, subjects_with_prep, default_location, tutoring_active)
values
  ('billy@highergroundlearning.com', 'Billy Thomas', 'America/Denver', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Calculus', 'Trigonometry', 'Statistics', 'Earth Science', 'Health & Nutrition', 'Biology', 'Biology Honors', 'Chemistry', 'Chemistry Honors', 'Physics', 'AP/IB Physics', 'Grammar', 'Essays', 'Creative Writing', 'Reading', 'Literature', 'Study Skills', 'Spanish', 'French', 'Geography', 'US History', 'World History', 'European History', 'Psychology', 'Political Science', 'SAT', 'SAT Subject Tests', 'ACT', 'GRE', 'GED', 'PSAT'], '{}'::text[], 'https://us06web.zoom.us/j/3451590427?pwd=NzlVczJJZTRFQ2NWNU9TbnBvSm8zZz09', false),
  ('eric@highergroundlearning.com', 'Eric Brown', 'America/New_York', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'AP/IB Calculus', 'Trigonometry', 'Physics', 'Grammar', 'Essays', 'Creative Writing', 'Reading', 'Literature', 'World Literature', 'Literary Theory', 'Study Skills', 'Geography', 'US History', 'SAT', 'SAT Subject Tests', 'PSAT', 'ACT', 'ACT Writing', 'GRE', 'GED', 'GMAT', 'Praxis'], '{}'::text[], 'https://us02web.zoom.us/j/4794457129?pwd=V2hTY2hHeXVlMHVSM1g1OFJmbm9yZz09', false),
  ('kaile@highergroundlearning.com', 'Kaile Cota', 'America/New_York', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Earth Science', 'Biology', 'Biology Honors', 'Chemistry', 'Chemistry Honors', 'Grammar', 'Reading', 'Study Skills', 'Literature'], array['Pre-Calculus', 'Trigonometry', 'Essays', 'Geography', 'US History', 'World History', 'European History', 'Political Science', 'Psychology', 'ACT', 'SAT'], null, false),
  ('gwen@highergroundlearning.com', 'Gwen De Silva', 'America/Denver', array['SAT', 'PSAT', 'ACT'], '{}'::text[], 'https://us02web.zoom.us/j/2869190098?pwd=Nnh6bnNCNElSZzQyeHkwdElyYUxWUT09', false),
  ('rebecca@highergroundlearning.com', 'Rebecca Baumher', 'America/New_York', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Calculus', 'AP/IB Calculus', 'Trigonometry', 'Statistics', 'Physics', 'Chemistry', 'SAT', 'ACT', 'PSAT'], array['Chemistry Honors', 'AP/IB Physics'], null, false),
  ('kevin@highergroundlearning.com', 'Kevin Marren', 'America/Los_Angeles', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Trigonometry', 'Statistics', 'Physics', 'Grammar', 'Study Skills'], array['Calculus', 'Chemistry', 'Creative Writing', 'Reading', 'Literature', 'Spanish', 'Psychology', 'ACT', 'SAT'], null, false),
  ('heather@highergroundlearning.com', 'Heather Witzel Lakin', 'America/New_York', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Calculus', 'AP/IB Calculus', 'Trigonometry', 'Physics', 'AP/IB Physics', 'Essays', 'Reading', 'Literature', 'ACT', 'SAT', 'PSAT'], array['Grammar'], null, false),
  ('delaneyh@highergroundlearning.com', 'Delaney Hall', 'America/Denver', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Trigonometry', 'Biology', 'Chemistry', 'Grammar', 'Reading', 'Study Skills', 'Literature', 'Psychology', 'SAT', 'PSAT'], array['Calculus', 'Statistics', 'Biology Honors', 'Chemistry Honors', 'Physics', 'Essays', 'ACT'], null, false),
  ('julia@highergroundlearning.com', 'Julia Fusia', 'America/Los_Angeles', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Earth Science', 'Chemistry', 'Chemistry Honors', 'Physics', 'Grammar', 'Reading', 'Literature', 'SAT', 'ACT'], array['Calculus', 'Trigonometry', 'Statistics', 'Biology', 'Study Skills', 'PSAT'], null, false),
  ('jason@highergroundlearning.com', 'Jason Topa', 'America/New_York', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Calculus', 'Trigonometry', 'Earth Science', 'Physics', 'Grammar', 'Essays', 'Creative Writing', 'Reading', 'Literature', 'US History', 'World History', 'Political Science', 'SAT', 'SAT Subject Tests', 'PSAT', 'ACT', 'ACT Writing', 'GRE', 'GED', 'GMAT', 'Praxis'], '{}'::text[], null, false),
  ('alexa@highergroundlearning.com', 'Alexa Jordan', 'Europe/London', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Trigonometry', 'Physics', 'Grammar', 'Essays', 'Creative Writing', 'Reading', 'Literature', 'World Literature', 'Literary Theory', 'Study Skills', 'Spanish', 'US History', 'Political Science', 'European History', 'SAT', 'ACT', 'PSAT'], array['Chemistry', 'Calculus'], null, false),
  ('austinw@highergroundlearning.com', 'Austin Webb', 'America/Phoenix', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Trigonometry', 'Statistics', 'Earth Science', 'Grammar', 'Essays', 'Creative Writing', 'Reading', 'Literature', 'World Literature', 'Literary Theory', 'Study Skills', 'Geography', 'US History', 'World History', 'Psychology'], array['Biology', 'Chemistry', 'ACT', 'SAT'], null, false),
  ('alexc@highergroundlearning.com', 'Alex Cook', 'America/Denver', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Calculus', 'Trigonometry', 'Statistics', 'Biology', 'Grammar', 'Essays', 'Creative Writing', 'Study Skills', 'Geography', 'US History', 'World History', 'ACT', 'SAT'], array['Physics', 'Reading', 'Literature', 'French', 'European History', 'Psychology'], null, false),
  ('quinn@highergroundlearning.com', 'Quinn Murphey', 'America/Chicago', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Calculus', 'AP/IB Calculus', 'Trigonometry', 'Statistics', 'Earth Science', 'Health & Nutrition', 'Biology', 'Biology Honors', 'Chemistry', 'Chemistry Honors', 'Physics', 'AP/IB Physics', 'Computer Science', 'Study Skills'], '{}'::text[], 'https://us06web.zoom.us/j/6651170915?pwd=W1csBEV2vklkXGSbEUEBbMzuEZ8CDC.1', false),
  ('ashley@highergroundlearning.com', 'Ashley Khouri', 'America/New_York', array['Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Earth Science', 'Biology', 'Biology Honors', 'Chemistry', 'Chemistry Honors', 'Grammar', 'Essays', 'Reading', 'Study Skills', 'Literature', 'Spanish', 'ACT', 'SAT', 'PSAT'], array['MCAT'], null, false),
  ('charlotte@highergroundlearning.com', 'Charlotte Thayer', 'America/New_York', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Calculus', 'Trigonometry', 'Statistics', 'Physics', 'Grammar', 'Essays', 'Reading', 'Study Skills', 'ACT', 'SAT', 'PSAT'], '{}'::text[], 'https://zoom.us/j/4244415352?pwd=ampmaXMwbGxpTmlyTVR0Um9Iak5SUT09', false),
  ('ava@highergroundlearning.com', 'Ava Alexander', 'America/New_York', array['Grammar', 'Essays', 'Creative Writing', 'Reading', 'Literature', 'World Literature', 'Literary Theory', 'Study Skills', 'Psychology', 'SAT'], array['ACT'], null, false),
  ('katie@highergroundlearning.com', 'Katie Horvath', 'America/Denver', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Biology', 'Chemistry', 'Chemistry Honors', 'Grammar', 'Essays', 'Creative Writing', 'Reading', 'Literature', 'World Literature', 'Literary Theory', 'Study Skills', 'Psychology', 'ACT'], array['Pre-Calculus', 'SAT', 'PSAT'], 'https://zoom.us/j/8921603560?pwd=MEZ0UTVOUUU2bXdSeTc0czZMdmJpdz09', false),
  ('andie@highergroundlearning.com', 'Andie Arnold', 'America/Chicago', array['Arithmetic', 'Geometry', 'Pre-Algebra', 'Algebra 1', 'Algebra 2', 'Pre-Calculus', 'Calculus', 'AP/IB Calculus', 'Trigonometry', 'Earth Science', 'Biology', 'Chemistry', 'Physics', 'Grammar', 'Essays', 'Creative Writing', 'Reading', 'Literature', 'Study Skills', 'Geography', 'US History', 'World History', 'Psychology', 'European History', 'ACT', 'SAT', 'PSAT'], '{}'::text[], null, false),
  ('janet@highergroundlearning.com', 'Janet Amaya Pisco', 'America/Denver', array['Spanish', 'French', 'German'], '{}'::text[], 'https://zoom.us/j/3059947617?pwd=K2VSMXlXVDNua2o3SnpMeWcwZzZNQT09', false)
on conflict (email) do update set
  name = excluded.name,
  timezone = excluded.timezone,
  subjects = excluded.subjects,
  subjects_with_prep = excluded.subjects_with_prep,
  default_location = coalesce(excluded.default_location, public.instructors.default_location);

-- 4. Matching notes (staff-only side table; tutors can never read these).
insert into public.tutor_notes (instructor_id, notes)
values
  ((select id from public.instructors where lower(email) = 'billy@highergroundlearning.com'), 'Chairman'),
  ((select id from public.instructors where lower(email) = 'eric@highergroundlearning.com'), 'Executive Director; English: all. Timezone ~guessed (215). Seeded Zoom room is his GROUP room - confirm it is also his 1-on-1 default.'),
  ((select id from public.instructors where lower(email) = 'kaile@highergroundlearning.com'), 'Only reach out case by case. Timezone ~guessed (231 MI). Creates a per-student meeting link each time; Waterford.'),
  ((select id from public.instructors where lower(email) = 'gwen@highergroundlearning.com'), 'Online only; 5-10+ hours/wk.'),
  ((select id from public.instructors where lower(email) = 'rebecca@highergroundlearning.com'), 'Open to hours; Math: ALL. Timezone ~guessed (215). Google Meet default - no static room.'),
  ((select id from public.instructors where lower(email) = 'kevin@highergroundlearning.com'), 'As many hours/wk as available. Timezone ~guessed (650). Google Meet default - no static room.'),
  ((select id from public.instructors where lower(email) = 'heather@highergroundlearning.com'), 'Online only; 4-8 hours/wk; Maine. Google Meet default - no static room.'),
  ((select id from public.instructors where lower(email) = 'delaneyh@highergroundlearning.com'), 'Timezone unknown - defaulted Denver; Kelsie corrects at onboarding.'),
  ((select id from public.instructors where lower(email) = 'julia@highergroundlearning.com'), 'Timezone ~guessed (209).'),
  ((select id from public.instructors where lower(email) = 'jason@highergroundlearning.com'), 'HG contract worker; Test Prep: ALL. Timezone ~guessed (740 OH). Google Meet default - no static room.'),
  ((select id from public.instructors where lower(email) = 'alexa@highergroundlearning.com'), 'Traveling classes only; UK. English: ALL. Google Meet default - no static room.'),
  ((select id from public.instructors where lower(email) = 'austinw@highergroundlearning.com'), '3-8 hours/wk; English: ALL. Timezone ~guessed (520).'),
  ((select id from public.instructors where lower(email) = 'alexc@highergroundlearning.com'), 'NEVER CALL - email only. Timezone unknown - defaulted Denver.'),
  ((select id from public.instructors where lower(email) = 'quinn@highergroundlearning.com'), '"Everything" math; all sciences + CS; sheet lists no test prep. Timezone ~guessed (210 TX). WARNING: the sheet''s Zoom ID (947 517 1055) does not match the seeded link''s meeting ID (665 117 0915) - verify before relying on it.'),
  ((select id from public.instructors where lower(email) = 'ashley@highergroundlearning.com'), 'NEEDS-PREP SPLIT UNCONFIRMED: the sheet marked several of her subjects with asterisks but the specific ones were not captured - Scarlett is confirming; move any needs-prep subjects across when the answer lands. MCAT placed in needs-prep as an advanced default. Timezone ~guessed (814 PA).'),
  ((select id from public.instructors where lower(email) = 'charlotte@highergroundlearning.com'), 'Online only; Florida; open to hours; Math: ALL.'),
  ((select id from public.instructors where lower(email) = 'ava@highergroundlearning.com'), 'Proctor-only option; English: ALL. Timezone ~guessed (570 PA). Old-sheet Zoom link likely stale - Kelsie confirms before setting a default link.'),
  ((select id from public.instructors where lower(email) = 'katie@highergroundlearning.com'), 'Online only; 3-5 hours/wk; English: ALL. (801)'),
  ((select id from public.instructors where lower(email) = 'andie@highergroundlearning.com'), 'Fill-in / summers. Timezone ~guessed (402 NE). Old-sheet Zoom link likely stale - Kelsie confirms before setting a default link.'),
  ((select id from public.instructors where lower(email) = 'janet@highergroundlearning.com'), 'Alternate Spanish tutor; online only; ASK BEFORE SCHEDULING - whole-person gate, treat like needs-prep for scheduling regardless of subject. Contact via WhatsApp.')
on conflict (instructor_id) do update set notes = excluded.notes, updated_at = now();

-- PostgREST: pick up the new column
notify pgrst, 'reload schema';
