-- PL-386: family/contact facts become staff-editable in place. Email edits
-- are load-bearing (sign-in + every send), so the edit records who/when.
-- IDEMPOTENT.
alter table public.families add column if not exists contact_updated_by text;
alter table public.families add column if not exists contact_updated_at timestamptz;
comment on column public.families.contact_updated_by is
  'PL-386: the staff member who last edited the parent contact facts (email edits especially — sign-in + every send).';
notify pgrst, 'reload schema';
