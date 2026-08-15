-- PL-361: staff-assisted enrollment. Enrollments record HOW they were
-- created (source: NULL = the family's own online registration; 'staff' =
-- entered by staff for a phone signup; 'import' = the PL-363 cutover
-- importer) and who did it. A staff registration past the deadline records
-- the deliberate override (who/when). Offline payments (check/bank/comp)
-- record method + note + who — money facts, auditable, plain-English in the
-- family history. IDEMPOTENT: re-runnable.

alter table public.enrollments add column if not exists source text;
alter table public.enrollments drop constraint if exists enrollments_source_check;
alter table public.enrollments add constraint enrollments_source_check
  check (source is null or source in ('staff', 'import'));
comment on column public.enrollments.source is
  'PL-361/363: how this enrollment was created — NULL = online registration, staff = staff-assisted (phone signup), import = cutover importer.';

alter table public.enrollments add column if not exists source_recorded_by text;
comment on column public.enrollments.source_recorded_by is
  'PL-361: staff email that created a staff/import enrollment.';

alter table public.enrollments add column if not exists deadline_override_by text;
alter table public.enrollments add column if not exists deadline_override_at timestamptz;
comment on column public.enrollments.deadline_override_by is
  'PL-361: staff email that knowingly registered past the class deadline ("I know" recorded).';

alter table public.enrollments add column if not exists offline_payment_method text;
alter table public.enrollments drop constraint if exists enrollments_offline_method_check;
alter table public.enrollments add constraint enrollments_offline_method_check
  check (offline_payment_method is null or offline_payment_method in ('check', 'bank', 'comp'));
alter table public.enrollments add column if not exists offline_payment_note text;
alter table public.enrollments add column if not exists offline_recorded_by text;
alter table public.enrollments add column if not exists offline_recorded_at timestamptz;
comment on column public.enrollments.offline_payment_method is
  'PL-361: how an offline payment arrived (check/bank/comp). comp = $0 with the reason in offline_payment_note.';

notify pgrst, 'reload schema';
