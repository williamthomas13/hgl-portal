-- PL-350: first-party class-page analytics — which parts of the public
-- /c/{slug} pages do parents actually read? Section visibility, register
-- clicks, and shortlink arrivals, aggregated per class per Denver day.
-- No tracking vendor, no cookies, no PII: rows are (class, day, metric,
-- count) and nothing else — no IPs, no user agents, no identifiers. DNT is
-- honored client- AND server-side; the counting is disclosed in the class
-- pages' fine-print block (seeded in the PL-348 migration).
-- IDEMPOTENT: re-runnable as a set.

create table if not exists public.class_page_daily (
  class_id uuid not null references public.classes(id) on delete cascade,
  day date not null,
  metric text not null,
  count int not null default 0,
  primary key (class_id, day, metric)
);
comment on table public.class_page_daily is
  'PL-350: per-class per-Denver-day counters for the public class pages (visit, section:*, register-click, arrival:shortlink). Counts only — never identifiers.';

alter table public.class_page_daily enable row level security;
drop policy if exists "staff all" on public.class_page_daily;
create policy "staff all" on public.class_page_daily
  for all using (public.is_staff()) with check (public.is_staff());

-- One beacon bumps several metrics atomically (PostgREST can't increment).
create or replace function public.bump_class_page_metrics(
  p_class_id uuid, p_day date, p_metrics text[]
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.class_page_daily (class_id, day, metric, count)
  select distinct p_class_id, p_day, m, 1 from unnest(p_metrics) as m
  on conflict (class_id, day, metric) do update
    set count = class_page_daily.count + 1;
$$;

notify pgrst, 'reload schema';
