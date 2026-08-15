-- PL-349: the hgl.co shortlink service. A shortcode ("aisct") means "this
-- school's CURRENT class" — codes are REPOINTABLE so printed collateral
-- never dies: next season Kelsie repoints the code instead of reprinting.
-- /{code} resolves here and 302s to the class's public /c/{slug} page
-- (PL-348); unknown/idle codes get the honest no-active-class page, never
-- a 404. classes.short_link stays what it always was — the printed TEXT on
-- collateral; this table is the routing truth.
--
-- Seeded from the existing classes.short_link values ("hgl.co/asf" → code
-- 'asf' → that class). Click-throughs count per code/day (feeds PL-350).
-- IDEMPOTENT: re-runnable as a set (seed is on conflict do nothing).

create table if not exists public.short_links (
  code text primary key,
  class_id uuid references public.classes(id) on delete set null,
  -- The school the code "belongs" to — keeps the honest fallback page
  -- school-flavored even when the target class is deleted, and drives the
  -- repoint nudge when the school gains a new live class.
  school_id uuid references public.schools(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by text,
  created_at timestamptz not null default now(),
  constraint short_links_code_shape check (code ~ '^[a-z0-9-]{1,32}$')
);
comment on table public.short_links is
  'PL-349: hgl.co/{code} routing — repointable per-school shortcodes resolving to the current class''s /c/{slug} page.';

create table if not exists public.short_link_clicks (
  code text not null,
  day date not null,
  clicks int not null default 0,
  primary key (code, day)
);
comment on table public.short_link_clicks is
  'PL-349: click-throughs per code per Denver day (feeds the PL-350 rollup).';

alter table public.short_links enable row level security;
drop policy if exists "staff all" on public.short_links;
create policy "staff all" on public.short_links
  for all using (public.is_staff()) with check (public.is_staff());

alter table public.short_link_clicks enable row level security;
drop policy if exists "staff all" on public.short_link_clicks;
create policy "staff all" on public.short_link_clicks
  for all using (public.is_staff()) with check (public.is_staff());

-- Atomic per-day click bump (PostgREST upserts can't increment).
create or replace function public.bump_short_link_click(p_code text, p_day date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.short_link_clicks (code, day, clicks)
  values (p_code, p_day, 1)
  on conflict (code, day) do update set clicks = short_link_clicks.clicks + 1;
$$;

-- Seed: every stored classes.short_link ("hgl.co/asf", "hgl.link/x", with or
-- without scheme) contributes its trailing path segment as a code pointing
-- at that class. Newest class wins a contested code; malformed values that
-- don't yield a valid code are skipped (they still print as text on
-- collateral — routing just never knew them).
insert into public.short_links (code, class_id, school_id)
select distinct on (code) code, id, school_id from (
  select
    lower(trim(substring(short_link from '([^/\s]+)\s*$'))) as code,
    id,
    school_id,
    created_at
  from public.classes
  where short_link is not null and short_link like '%/%'
) candidates
where code ~ '^[a-z0-9-]{1,32}$'
order by code, created_at desc
on conflict (code) do nothing;

notify pgrst, 'reload schema';
