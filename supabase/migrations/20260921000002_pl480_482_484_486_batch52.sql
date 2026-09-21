-- Batch 52 (Sep 21 2026) — additive only (two-phase rule: column-first).
--
-- PL-482: split names on leads (the single-name columns stay as the derived
-- display name; PL-466: both surnames live in the last-name field, never split).
alter table public.leads add column if not exists contact_first_name text;
alter table public.leads add column if not exists contact_last_name text;
alter table public.leads add column if not exists student_first_name text;
alter table public.leads add column if not exists student_last_name text;
-- PL-482: how they want us to get in touch (whatsapp | call | text | email).
alter table public.leads add column if not exists connect_pref text;

-- PL-484: the interest list gets a person — split names, the Compass opt-in
-- (never pre-checked), and its own unsubscribe (separate from Compass).
alter table public.class_interest add column if not exists parent_first_name text;
alter table public.class_interest add column if not exists parent_last_name text;
alter table public.class_interest add column if not exists student_first_name text;
alter table public.class_interest add column if not exists compass_opt_in boolean not null default false;
alter table public.class_interest add column if not exists unsubscribed_at timestamptz;
alter table public.class_interest add column if not exists confirmation_sent_at timestamptz;
create index if not exists idx_class_interest_email on public.class_interest (email);

-- PL-486: timecards can be VOIDED — admin-only, reason required, excluded
-- from totals / exports / approval queues, never re-created by the sweep,
-- visible in history. (The three Sep 1–15 records-only class-hours cards +
-- Billy's MIS-placeholder card are voided by the PL-486 script, not here.)
alter table public.timecards drop constraint if exists timecards_status_check;
alter table public.timecards add constraint timecards_status_check
  check (status in ('open', 'tutor_confirmed', 'approved', 'exported', 'void'));
alter table public.timecards add column if not exists void_reason text;
alter table public.timecards add column if not exists voided_by text;
alter table public.timecards add column if not exists voided_at timestamptz;

-- PL-480: HGL's long-standing "class is full" wording is ONE source — the
-- waitlist-note site block (editable under Settings → Class pages). Update
-- the seeded body to Scarlett's wording ONLY if it still reads as seeded
-- (a hand-edited block is never overwritten).
update public.site_content_blocks
   set body_markdown = $md$When a class is full, we'll try to teach an additional section. Leave us your email and we'll notify you if we're able to open up a place for you!$md$
 where key = 'waitlist-note'
   and body_markdown = $md$When a class is full, we'll try to teach an additional section. Join the waitlist and we'll notify you if we're able to open up a place for you!$md$;

notify pgrst, 'reload schema';
