-- =============================================================================
-- HGL Portal — Feature A1/A2: email_sends canonical send log
-- (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A2)
-- =============================================================================
-- One row per individual email to one recipient — scheduled, held, cancelled,
-- and sent are ALL states of the same table (no parallel queue). This table
-- REPLACES email_log as the idempotency claim: sendOnce() now claims here
-- (unique dedupe_key), the Phase 2 sweep projects upcoming sends into
-- status='scheduled' rows, and the Resend webhook updates engagement fields
-- by resend_email_id. email_log stays in place as read-only legacy history;
-- its rows are backfilled below so every existing dedupe key keeps blocking
-- re-sends.
--
-- Statuses: scheduled | held | cancelled | sending | sent | delivered |
--           bounced | complained | failed
--   * 'sending' is the transient claim state (crash-safe: a stuck 'sending'
--     row blocks duplicates rather than double-sending).
--   * delivered/bounced/complained are webhook upgrades of 'sent'.
--
-- RLS (spec cross-cutting §3): staff (admin+manager) full access — the
-- comms dashboard runs on the browser client like the rest of /admin;
-- instructors read ONLY their own IM_INSTRUCTOR_MESSAGE sends. No anon, no
-- parent/counselor access.
--
-- IDEMPOTENT: re-runnable as a set (project migration rule).
-- =============================================================================

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique not null,
  template_key text not null,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  class_id uuid references public.classes(id) on delete set null,
  recipient_email text not null,
  recipient_role text not null default 'parent'
    check (recipient_role in ('parent', 'student', 'counselor', 'admin', 'instructor')),
  -- Who composed it (Feature B3 instructor messages) — drives instructor
  -- self-read RLS. Null for pipeline sends.
  sender_email text,
  cc text[],
  scheduled_for timestamptz not null default now(),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'held', 'cancelled', 'sending', 'sent',
                      'delivered', 'bounced', 'complained', 'failed')),
  -- Admin used Reschedule: the sweep's date-change recomputation must not
  -- clobber a hand-picked time.
  manually_rescheduled boolean not null default false,
  -- A4 "send test to me" rows: visible in history, excluded from stats.
  is_test boolean not null default false,
  sent_at timestamptz,
  delivered_at timestamptz,
  first_opened_at timestamptz,
  first_clicked_at timestamptz,
  bounced_at timestamptz,
  open_count integer not null default 0,
  click_count integer not null default 0,
  resend_email_id text,
  subject_rendered text,
  -- FK to email_template_versions arrives with the A4 migration.
  body_snapshot_id uuid,
  -- Ports email_log's payload mechanism (schedule-update change snapshots).
  payload jsonb,
  hold_reason text,
  cancel_reason text,
  cancelled_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_sends_status_scheduled
  on public.email_sends (status, scheduled_for);
create index if not exists idx_email_sends_enrollment
  on public.email_sends (enrollment_id);
create index if not exists idx_email_sends_resend_id
  on public.email_sends (resend_email_id);
create index if not exists idx_email_sends_class
  on public.email_sends (class_id);

alter table public.email_sends enable row level security;

drop policy if exists "staff all" on public.email_sends;
create policy "staff all" on public.email_sends
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "instructor own messages" on public.email_sends;
create policy "instructor own messages" on public.email_sends
  for select to authenticated
  using (
    template_key = 'IM_INSTRUCTOR_MESSAGE'
    and sender_email is not null
    and lower(sender_email) = public.jwt_email()
  );

-- ---------------------------------------------------------------------------
-- Backfill: every email_log row becomes a sent (or superseded→cancelled)
-- email_sends row so existing dedupe keys keep their guarantees after the
-- claim moves here. template_key mapping follows the spec's A4 registry;
-- history that predates the registry gets stable non-registry keys.
-- ---------------------------------------------------------------------------

insert into public.email_sends
  (dedupe_key, template_key, enrollment_id, recipient_email, recipient_role,
   scheduled_for, status, sent_at, payload, cancel_reason, created_at)
select
  l.dedupe_key,
  case
    when l.email_type = 'parent_confirmation'  then 'E0_CONFIRM_PARENT'
    when l.email_type = 'student_confirmation' then 'E0_CONFIRM_STUDENT'
    when l.email_type = 'payment_reminder' and l.dedupe_key like 'payment_reminder_1:%' then 'PR1'
    when l.email_type = 'payment_reminder' and l.dedupe_key like 'payment_reminder_2:%' then 'PR2'
    when l.email_type = 'payment_reminder' and l.dedupe_key like 'payment_reminder_3:%' then 'PR3'
    when l.email_type = 'payment_reminder' and l.dedupe_key like 'payment_reminder_4:%' then 'PR4'
    when l.email_type = 'thank_you'         then 'E1_THANKS'
    when l.email_type = 'synap_access' and l.dedupe_key like 'synap_access_s:%' then 'E2_DIAG_STUDENT'
    when l.email_type = 'synap_access'      then 'E2_DIAG_PARENT'
    when l.email_type = 'faq'               then 'E3_VFAQ'
    when l.email_type = 'class_details'     then 'E4_CLASS_DETAILS'
    when l.email_type = 'location_reminder' then 'E5_LOCATION'
    when l.email_type = 'second_diagnostic' then 'E6_DIAG2'
    when l.email_type = 'review_request'    then 'E7_REVIEW'
    when l.email_type = 'tutoring_offer'    then 'E8_POSTCLASS_TUTORING'
    when l.email_type = 'tutoring_upsell'   then 'E9_UPSELL'
    when l.email_type = 'waitlist_confirmation' then 'W1_WAITLIST'
    when l.email_type = 'waitlist_offer'    then 'W2_SPOT_OPEN'
    when l.email_type = 'schedule_update'   then 'SU_SCHEDULE_UPDATE'
    when l.email_type = 'late_welcome'      then 'LR_WELCOME'
    when l.email_type = 'counselor_digest'  then 'CD_COUNSELOR_DIGEST'
    when l.email_type = 'classroom_request' then 'CR_CLASSROOM_REQUEST'
    when l.email_type = 'deadline_push'     then 'FP_DEADLINE_PUSH'
    when l.email_type = 'class_full_notice' then 'FP_ALT_CLASS_FULL'
    when l.email_type = 'class_cancellation' then 'CX_CANCELLATION'
    when l.email_type = 'instructor_nudge'  then 'ADMIN_INSTRUCTOR_NUDGE'
    when l.email_type = 'admin_alert'       then 'ADMIN_ALERT'
    when l.email_type = 'login_link'        then 'LOGIN_LINK'
    when l.email_type = 'superseded_by_welcome' then 'SUPERSEDED'
    else upper(l.email_type)
  end,
  l.enrollment_id,
  lower(coalesce(l.recipients[1], 'unknown@invalid')),
  case
    when l.dedupe_key like '%_s:%' or l.email_type = 'student_confirmation' then 'student'
    when l.email_type in ('counselor_digest', 'classroom_request', 'deadline_push',
                          'class_full_notice') then 'counselor'
    when l.email_type in ('admin_alert', 'instructor_nudge') then 'admin'
    else 'parent'
  end,
  l.sent_at,
  case when l.email_type = 'superseded_by_welcome' then 'cancelled' else 'sent' end,
  case when l.email_type = 'superseded_by_welcome' then null else l.sent_at end,
  l.payload,
  case when l.email_type = 'superseded_by_welcome'
       then 'superseded by combined late-registration welcome' end,
  l.sent_at
from public.email_log l
on conflict (dedupe_key) do nothing;

-- PostgREST: pick up the new table
notify pgrst, 'reload schema';
