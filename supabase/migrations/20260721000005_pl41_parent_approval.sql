-- =============================================================================
-- HGL Portal — PL-41: parent approval of a proposed tutoring schedule
-- =============================================================================
-- New Student Schedule wizard gains a "send the parent this schedule to
-- confirm" toggle (default ON): the engagement is created in
-- pending_parent_confirmation, sessions stay un-pushed, and the family gets
-- a one-click signed approval link with +2/+5-day nudges (never
-- auto-approved — the +5 alert sends Kelsie to the phone instead).
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

alter table public.tutoring_engagements
  drop constraint if exists tutoring_engagements_status_check;
alter table public.tutoring_engagements
  add constraint tutoring_engagements_status_check
  check (status in ('pending_parent_confirmation', 'active', 'paused', 'ended'));

alter table public.tutoring_engagements
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_nudge_count int not null default 0,
  add column if not exists parent_approved_at timestamptz,
  add column if not exists parent_decline_note text;

comment on column public.tutoring_engagements.approval_requested_at is
  'PL-41: when the confirm-this-schedule email went to the family. Null on '
  'schedules Kelsie set up directly (toggle off).';
comment on column public.tutoring_engagements.parent_decline_note is
  'PL-41: the family''s "different times please" note — engagement stays '
  'pending and the Ops Director is alerted to adjust and re-send.';

notify pgrst, 'reload schema';
