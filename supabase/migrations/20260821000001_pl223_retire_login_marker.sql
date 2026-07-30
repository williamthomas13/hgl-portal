-- PL-223: access-aware retire. When retiring a tutor-only person (no other
-- active teaching) also ends their portal login, remember that it was THIS
-- flow that turned the login off — so un-retire from the Former tab can
-- restore it without ever silently re-enabling a login that someone
-- deactivated separately on the Instructors page.
alter table instructors
  add column if not exists login_ended_by_retire boolean not null default false;
