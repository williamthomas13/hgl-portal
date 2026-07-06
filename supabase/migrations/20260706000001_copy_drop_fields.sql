-- =============================================================================
-- HGL Portal: fields required by the final email copy (docs/EMAIL_COPY.md)
-- =============================================================================
-- Registration form gains accommodations / previous scores / notes (rendered
-- in the #0-P order confirmation recap) and switches grade level to
-- graduating year. amount_paid is captured from Stripe at payment so #0-P can
-- show the real charged total (class + any add-on).
-- =============================================================================

alter table public.students
  add column if not exists graduating_year text;

alter table public.enrollments
  add column if not exists accommodations text;

alter table public.enrollments
  add column if not exists previous_scores text;

alter table public.enrollments
  add column if not exists notes text;

alter table public.enrollments
  add column if not exists amount_paid numeric;
