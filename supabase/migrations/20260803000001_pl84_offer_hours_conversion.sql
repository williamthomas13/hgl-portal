-- PL-84: the cancellation's HOURS offer becomes a first-class record.
--   · enrollments.cancellation_offer_hours — persisted at cancel time (today
--     it was only computed into the CX email, so conversion had to fall back
--     to dollars and Kelsie had to re-derive the promised hours per family).
--   · enrollment_addons grows a `source` and a nullable package_id so a
--     conversion can mint an HOURS PACKAGE through the existing add-on
--     machinery (hours balance, package-covered proposals, #8b hours
--     remaining) without inventing a catalog package for arbitrary hours.
-- Dollar Stripe credit remains only as the no-hours-offer fallback.
-- Idempotent.

alter table public.enrollments
  add column if not exists cancellation_offer_hours integer;

alter table public.enrollment_addons
  alter column package_id drop not null;

alter table public.enrollment_addons
  add column if not exists source text not null default 'purchase';

alter table public.enrollment_addons
  drop constraint if exists enrollment_addons_source_check;
alter table public.enrollment_addons
  add constraint enrollment_addons_source_check
  check (source in ('purchase', 'cancellation_conversion'));

-- A conversion row must say where its hours came from even without a
-- catalog package.
alter table public.enrollment_addons
  drop constraint if exists enrollment_addons_package_or_conversion;
alter table public.enrollment_addons
  add constraint enrollment_addons_package_or_conversion
  check (package_id is not null or source = 'cancellation_conversion');

notify pgrst, 'reload schema';
