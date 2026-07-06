-- =============================================================================
-- HGL Portal: 1-on-1 tutoring packages + enrollment add-ons
-- =============================================================================
-- tutoring_packages drives all pricing shown in checkout, the addon page,
-- and emails #8/#9 — savings are always computed from these rows, never
-- hardcoded. enrollment_addons durably stores purchased hours: they become
-- schedulable sessions in the future TutorBird-replacement phase.
-- No merch/physical products — classes and tutoring packages only.
-- =============================================================================

create table if not exists public.tutoring_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hours numeric not null,
  hourly_rate numeric not null,
  package_price numeric not null,
  regular_hourly_rate numeric not null default 130,
  phase text not null check (phase in ('pre_class', 'post_class')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.enrollment_addons (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  package_id uuid not null references public.tutoring_packages(id),
  hours numeric not null,       -- snapshot at purchase: schedulable later
  price_paid numeric not null,  -- snapshot at purchase
  stripe_session_id text,
  purchased_at timestamptz not null default now(),
  unique (enrollment_id, package_id)
);

create index if not exists idx_enrollment_addons_enrollment
  on public.enrollment_addons(enrollment_id);

-- This Supabase project auto-enables RLS on new tables — turn it off
-- explicitly until the auth phase.
alter table public.tutoring_packages disable row level security;
alter table public.enrollment_addons disable row level security;

-- Seed only when empty (safe to re-run).
insert into public.tutoring_packages
  (name, hours, hourly_rate, package_price, regular_hourly_rate, phase)
select * from (values
  ('5-Hour Package',  5::numeric, 120::numeric,  600::numeric, 130::numeric, 'pre_class'),
  ('10-Hour Package', 10,         105,          1050,          130,          'pre_class'),
  ('15-Hour Package', 15,          95,          1425,          130,          'pre_class'),
  ('Post-Class Hourly (1-9 hours)', 1, 125,      125,          130,          'post_class'),
  ('Post-Class Hourly (10+ hours)', 10, 115,    1150,          130,          'post_class')
) as seed(name, hours, hourly_rate, package_price, regular_hourly_rate, phase)
where not exists (select 1 from public.tutoring_packages);
