-- PL-78/PL-79: instructor comms + calendar sync.
--
-- The batch-11 doc assumed instructors had no emails on file as the natural
-- safety gate; in reality every instructor row carries their login email.
-- comms_enabled reproduces the INTENDED gate explicitly: nothing sends and
-- no calendar events are created until the Ops Director switches an
-- instructor on (that switch is the "email added" backfill moment).
alter table public.instructors
  add column if not exists comms_enabled boolean not null default false;

-- PL-79: class sessions get an event on the (comms-enabled) instructor's own
-- calendar — created via the same delegated service-account machinery the
-- tutoring events use, no attendees, so there is never invite-email noise.
-- The owning email rides along so reassignment can clean up the old
-- instructor's events idempotently.
alter table public.sessions
  add column if not exists instructor_gcal_event_id text;
alter table public.sessions
  add column if not exists instructor_gcal_email text;
