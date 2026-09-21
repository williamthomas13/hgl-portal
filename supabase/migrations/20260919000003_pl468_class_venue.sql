-- PL-468: in-person classes have a VENUE known at sign-up ("On campus at
-- ASF") and a ROOM confirmed later by the school ("Room US 109"). One field
-- conflated them: typing the campus suppressed the classroom request and the
-- counselor's answer overwrote the campus. `venue` is the new, optional
-- class-level line (null = composed from the school at render time);
-- `default_location` keeps meaning the ROOM — blank until confirmed.
-- Additive, idempotent.
alter table public.classes
  add column if not exists venue text;

comment on column public.classes.venue is
  'PL-468: in-person venue known at creation (e.g. "ASF campus"); null = "On campus at {school name}" composed at render. default_location is the ROOM.';

-- Data fix (Sep 21 finding): ASF fall 2026 carried both in the one field.
update public.classes
   set venue = 'ASF campus', default_location = 'Room US 109'
 where slug = 'asf-sat-prep-fall26'
   and default_location = 'ASF campus — Room US 109';
