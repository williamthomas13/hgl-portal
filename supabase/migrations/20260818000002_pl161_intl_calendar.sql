-- PL-161: the portal takes over the hand-managed International Classes
-- Google Calendar IN PLACE. Event ids anchor adopted/created events; the
-- hash records what the portal last wrote so a hand edit (live event differs
-- while the portal state hasn't moved) is DETECTED by the drift audit rather
-- than silently overwritten. Idempotent.
alter table public.classes
  add column if not exists intl_gcal_event_id text,
  add column if not exists intl_gcal_hash text;

alter table public.sessions
  add column if not exists intl_gcal_event_id text,
  add column if not exists intl_gcal_hash text;

comment on column public.classes.intl_gcal_event_id is
  'PL-161: the class-level SPAN event on the shared International Classes calendar (adopted or created).';
comment on column public.sessions.intl_gcal_event_id is
  'PL-161: this session''s block event on the shared International Classes calendar.';

-- The calendar itself is configuration, not code:
--   app_settings intl_classes_calendar_id    (the shared calendar''s id)
--   app_settings intl_classes_calendar_owner (Workspace user to impersonate; defaults to billy@)
-- The sync no-ops until the id is set.
