-- PL-465: a tutoring add-on that the cutover import brings in "as paid" —
-- hours on the books, schedulable through the normal tutoring flow, no
-- Stripe ids (the old system took the money), never enqueued to QuickBooks.
-- The import stamps source='import' so nothing downstream mistakes it for a
-- portal purchase. Idempotent.
alter table public.enrollment_addons
  drop constraint if exists enrollment_addons_source_check;
alter table public.enrollment_addons
  add constraint enrollment_addons_source_check
  check (source in ('purchase', 'cancellation_conversion', 'import'));

-- An imported add-on carries hours + what was paid but no tutoring_packages
-- row (the old system's package names are not the portal's) — like a
-- cancellation conversion, it is hours on the books without a package ref.
alter table public.enrollment_addons
  drop constraint if exists enrollment_addons_package_or_conversion;
alter table public.enrollment_addons
  add constraint enrollment_addons_package_or_conversion
  check (package_id is not null or source in ('cancellation_conversion', 'import'));

notify pgrst, 'reload schema';
