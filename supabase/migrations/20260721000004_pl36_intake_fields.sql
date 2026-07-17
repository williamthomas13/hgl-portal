-- =============================================================================
-- HGL Portal — PL-36: intake answers persist to the family/student records
-- =============================================================================
-- The fuller intake form (7e + PL-19) already CAPTURES student phone, second
-- guardian, and allergies/needs, but they only landed in leads.intake jsonb.
-- Retiring the Google intake form needs them durable on the actual records.
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

alter table public.students
  add column if not exists student_phone text,
  add column if not exists special_needs text;

comment on column public.students.special_needs is
  'PL-36: "anything we should know" from intake — learning differences, '
  'allergies, accommodations. Family-provided; staff may edit.';

alter table public.families
  add column if not exists guardian2_name text,
  add column if not exists guardian2_phone text,
  add column if not exists guardian2_email text;

comment on column public.families.guardian2_name is
  'PL-36: optional second parent/guardian from the intake form.';

notify pgrst, 'reload schema';
