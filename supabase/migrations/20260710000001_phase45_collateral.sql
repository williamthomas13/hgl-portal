-- =============================================================================
-- Phase 4.5: Course collateral generation (docs/hgl-phase4.5-collateral-spec.md §3)
-- =============================================================================
-- Adds the fields that drive the parent letter + student flyer, plus the two
-- storage buckets: school-assets (public read — school logos) and
-- collateral-private (no public access — the signature image, fetched
-- server-side with the service role at render time).
--
-- Idempotent by project rule: the user re-runs migration files as a set in the
-- SQL editor, so every statement tolerates having already been applied.
-- No RLS changes: all columns land on existing tables whose policies already
-- scope reads (staff everything, counselors their school's classes).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. schools: collateral branding + default language
-- -----------------------------------------------------------------------------
alter table public.schools add column if not exists logo_url text;
alter table public.schools add column if not exists accent_color text;
alter table public.schools
  add column if not exists collateral_language text not null default 'en';

alter table public.schools drop constraint if exists schools_collateral_language_check;
alter table public.schools add constraint schools_collateral_language_check
  check (collateral_language in ('en', 'es', 'both'));

-- Hex color or blank ("#7a1f3d" style). Blank/null = default HGL blue.
alter table public.schools drop constraint if exists schools_accent_color_check;
alter table public.schools add constraint schools_accent_color_check
  check (accent_color is null or accent_color ~* '^#[0-9a-f]{6}$');

-- -----------------------------------------------------------------------------
-- 2. classes: collateral fields (spec §3 + copy deck note 4: letter_blurb_es)
-- -----------------------------------------------------------------------------
alter table public.classes add column if not exists short_link text;
alter table public.classes add column if not exists collateral_language text;
alter table public.classes add column if not exists letter_blurb text;
alter table public.classes add column if not exists letter_blurb_es text;
alter table public.classes add column if not exists flyer_blurb text;
alter table public.classes
  add column if not exists practice_test_count int not null default 2;

-- Promo fields are display-only (spec §6a): the real discount is a Stripe
-- promotion code; these three drive the flyer burst / letter summary line.
alter table public.classes add column if not exists promo_code text;
alter table public.classes add column if not exists promo_amount numeric;
alter table public.classes add column if not exists promo_deadline date;

alter table public.classes drop constraint if exists classes_collateral_language_check;
alter table public.classes add constraint classes_collateral_language_check
  check (collateral_language is null or collateral_language in ('en', 'es', 'both'));

-- -----------------------------------------------------------------------------
-- 2a. Regeneration notice plumbing (spec §8): stamp the class whenever a
-- detail that appears on collateral changes, from ANY edit path. The digest
-- compares the stamp to digest_last_sent_at and flags "materials updated".
-- -----------------------------------------------------------------------------
alter table public.classes add column if not exists collateral_changed_at timestamptz;

-- Sessions feed dateRange/dayPattern/classTime/classroomHours. SECURITY
-- DEFINER so a staff session edit doesn't depend on a classes UPDATE policy.
create or replace function public.touch_collateral_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.classes set collateral_changed_at = now()
  where id = coalesce(new.class_id, old.class_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists sessions_touch_collateral on public.sessions;
create trigger sessions_touch_collateral
after insert or update or delete on public.sessions
for each row execute function public.touch_collateral_changed();

create or replace function public.stamp_collateral_changed()
returns trigger
language plpgsql
as $$
begin
  new.collateral_changed_at := now();
  return new;
end;
$$;

-- Only the columns that print on the flyer/letter; collateral_changed_at
-- itself is excluded, so the sessions trigger can't recurse through here.
drop trigger if exists classes_touch_collateral on public.classes;
create trigger classes_touch_collateral
before update of class_type, delivery_mode, capacity, enrollment_deadline,
  default_location, short_link, collateral_language, letter_blurb,
  letter_blurb_es, flyer_blurb, practice_test_count, promo_code, promo_amount,
  promo_deadline
on public.classes
for each row execute function public.stamp_collateral_changed();

-- -----------------------------------------------------------------------------
-- 3. Storage buckets
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('school-assets', 'school-assets', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('collateral-private', 'collateral-private', false)
on conflict (id) do nothing;

-- school-assets: anyone may read (logos render on public-facing collateral);
-- only staff may write. collateral-private gets NO policies — the service
-- role bypasses RLS, everyone else sees nothing.
drop policy if exists "school assets public read" on storage.objects;
create policy "school assets public read" on storage.objects
  for select using (bucket_id = 'school-assets');

drop policy if exists "school assets staff insert" on storage.objects;
create policy "school assets staff insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'school-assets' and public.is_staff());

drop policy if exists "school assets staff update" on storage.objects;
create policy "school assets staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'school-assets' and public.is_staff())
  with check (bucket_id = 'school-assets' and public.is_staff());

drop policy if exists "school assets staff delete" on storage.objects;
create policy "school assets staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'school-assets' and public.is_staff());

notify pgrst, 'reload schema';
