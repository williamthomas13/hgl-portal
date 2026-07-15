-- =============================================================================
-- HGL Portal — Phase 7a: 1-on-1 tutoring core schema (docs/PHASE7_SPEC.md §3)
-- =============================================================================
-- Tutors ARE instructors (decided July 10 with Scarlett): the same people are
-- "instructors" teaching group classes and "tutors" doing 1-on-1, so there is
-- no tutors table and no new role — tutoring columns land on public.instructors
-- and every tutor_id below is an FK to instructors. RLS composes through the
-- existing email-linkage pattern (jwt_email(), like instructor_class_ids()),
-- exactly as spec §2 required ("do not create parallel auth").
--
-- Tables: subjects (rate lookup), tutor_notes (staff-only matching notes),
-- tutoring_engagements, tutoring_sessions, tutoring_invoices +
-- tutoring_invoice_lines and timecards (created now as shells so sessions can
-- FK them; 7b/7c animate them), gcal_connection (encrypted service-account
-- key, qbo_connection zero-policy pattern), gcal_sync_log (push queue,
-- qbo_sync_log claim/backoff pattern).
--
-- Timezone: tutoring HQ is Salt Lake City, so the org default on the tutoring
-- side is America/Denver (schools.timezone keeps its own default — that's the
-- group-class side). families.timezone stays null unless a family really is
-- elsewhere; renderers fall back to the tutor's timezone, then America/Denver.
--
-- RLS: staff full CRUD (is_staff()); tutors read their own engagements/
-- sessions/timecards (write access arrives with 7b's timecard rules); parents
-- read their family's engagements/sessions/invoices. Deletion guards mirror
-- Phase 3.1: nothing billed is deletable by a manager — void/adjust instead.
--
-- IDEMPOTENT: safe to re-run as a set (guarded creates, add column if not
-- exists, drop-then-create policies, seed only when empty).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Instructors grow their tutoring profile (spec §3 "tutors", merged)
-- -----------------------------------------------------------------------------
alter table public.instructors
  add column if not exists tutoring_active boolean not null default false;
alter table public.instructors
  add column if not exists subjects text[] not null default '{}';
alter table public.instructors
  add column if not exists timezone text not null default 'America/Denver';
alter table public.instructors
  add column if not exists google_calendar_id text; -- null = use email (primary calendar)
alter table public.instructors
  add column if not exists default_location text;   -- online link or address; default_meeting_link stays class-side

comment on column public.instructors.tutoring_active is
  'Phase 7: this instructor also takes 1-on-1 tutoring engagements ("tutor" in UI copy).';

-- Matching/personality notes are staff-only and instructors can read their own
-- instructors row ("instructor self" policy), so the notes live in a side
-- table with no tutor-facing policy instead of a column they could read.
create table if not exists public.tutor_notes (
  instructor_id uuid primary key references public.instructors(id) on delete cascade,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.tutor_notes enable row level security;

drop policy if exists "staff all" on public.tutor_notes;
create policy "staff all" on public.tutor_notes
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- 2. Subjects: the tutoring rate lookup (spec §3). Category drives QBO revenue
--    mapping in 7c (test_prep → 408-1, subject_tutoring → 401).
-- -----------------------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  category text not null check (category in ('test_prep', 'subject_tutoring')),
  hourly_rate numeric not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.subjects enable row level security;

drop policy if exists "authenticated read" on public.subjects;
create policy "authenticated read" on public.subjects
  for select to authenticated
  using (true);
drop policy if exists "staff all" on public.subjects;
create policy "staff all" on public.subjects
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Seed from the 8/14/25 pricing sheet, standard LOCAL 1-on-1 rates only:
-- test prep $110/hr, subject tutoring (incl. AP unless test-focused) $75/hr.
-- Everything else on the sheet is an engagement-level hourly_rate override:
-- EB premium ($130/$100), weekend/out-of-state ($150), in-class follow-up
-- discount ($100), international ($130/$110), per-student group rates, and
-- sliding-scale reductions. Seed only when empty; staff edit from admin.
insert into public.subjects (name, category, hourly_rate)
select * from (values
  ('SAT',              'test_prep',        110::numeric),
  ('ACT',              'test_prep',        110),
  ('PSAT',             'test_prep',        110),
  ('GED',              'test_prep',        110),
  ('GRE',              'test_prep',        110),
  ('GMAT',             'test_prep',        110),
  ('ASVAB',            'test_prep',        110),
  ('College Essays',   'test_prep',        110),
  ('Math',             'subject_tutoring',  75),
  ('Science',          'subject_tutoring',  75),
  ('English',          'subject_tutoring',  75),
  ('History',          'subject_tutoring',  75),
  ('Foreign Language', 'subject_tutoring',  75),
  ('Computer Science', 'subject_tutoring',  75),
  ('AP Class Support', 'subject_tutoring',  75),
  ('Other Subject',    'subject_tutoring',  75)
) as seed(name, category, hourly_rate)
where not exists (select 1 from public.subjects);

-- -----------------------------------------------------------------------------
-- 3. Engagements: the recurring student × tutor × subject agreement (spec §3)
-- -----------------------------------------------------------------------------
create table if not exists public.tutoring_engagements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id uuid not null references public.instructors(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  hourly_rate numeric not null,           -- snapshot/override; wins over subject default
  funding text not null default 'monthly_billed'
    check (funding in ('monthly_billed', 'package')),
  addon_id uuid references public.enrollment_addons(id) on delete set null,
  -- Weekly slots: [{"weekday": 1..7 ISO, "start_time": "HH:MM", "duration_minutes": 60}].
  -- Empty array = one-off engagement (sessions created individually, no generation).
  recurrence jsonb not null default '[]'::jsonb,
  location text,                          -- online link or address; defaults from tutor
  status text not null default 'active'
    check (status in ('active', 'paused', 'ended')),
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (funding <> 'package' or addon_id is not null)
);

create index if not exists idx_tutoring_engagements_student
  on public.tutoring_engagements(student_id);
create index if not exists idx_tutoring_engagements_tutor
  on public.tutoring_engagements(tutor_id);
create index if not exists idx_tutoring_engagements_status
  on public.tutoring_engagements(status);

-- -----------------------------------------------------------------------------
-- 4. Billing/timecard shells (7b/7c animate these; created first so sessions
--    can carry their FKs from day one)
-- -----------------------------------------------------------------------------
create table if not exists public.tutoring_invoices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  period date not null,                   -- first of the month billed
  status text not null default 'draft'
    check (status in ('draft', 'proposed', 'confirmed', 'invoiced', 'paid', 'past_due', 'void')),
  subtotal numeric not null default 0,
  total numeric not null default 0,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  sent_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, period)              -- one invoice per family per month (spec §3)
);

create table if not exists public.tutoring_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.tutoring_invoices(id) on delete cascade,
  session_id uuid,                        -- FK added below (sessions created after)
  description text not null,
  qty_hours numeric not null,
  rate numeric,
  amount numeric not null,
  kind text not null default 'session'
    check (kind in ('session', 'late_reschedule_fee', 'late_payment_fee', 'adjustment', 'credit')),
  created_at timestamptz not null default now()
);

create index if not exists idx_tutoring_invoice_lines_invoice
  on public.tutoring_invoice_lines(invoice_id);

-- Semi-monthly pay periods: 1st–15th (payday the 20th), 16th–EOM (payday the
-- 5th). Hours only — pay rates live in QBO Payroll, never here (spec §7).
create table if not exists public.timecards (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.instructors(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'open'
    check (status in ('open', 'tutor_confirmed', 'approved', 'exported')),
  total_hours numeric not null default 0,
  tutor_confirmed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tutor_id, period_start)
);

create index if not exists idx_timecards_tutor_period
  on public.timecards(tutor_id, period_start);

-- -----------------------------------------------------------------------------
-- 5. Sessions: the schedulable/billable unit (spec §3)
-- -----------------------------------------------------------------------------
create table if not exists public.tutoring_sessions (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.tutoring_engagements(id) on delete cascade,
  -- Denormalized for cheap RLS/queries (spec §3); kept in sync by app writes.
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id uuid not null references public.instructors(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes integer generated always as
    (round(extract(epoch from (ends_at - starts_at)) / 60)::integer) stored,
  status text not null default 'confirmed'
    check (status in ('proposed', 'confirmed', 'completed', 'rescheduled', 'forfeited', 'no_show')),
  rescheduled_to_id uuid references public.tutoring_sessions(id) on delete set null,
  reschedule_notice text check (reschedule_notice in ('ok', 'late')),
  rate_snapshot numeric not null,         -- copied from engagement; rate changes never rewrite history
  gcal_event_id text,
  gcal_synced_at timestamptz,
  invoice_id uuid references public.tutoring_invoices(id) on delete set null,
  timecard_id uuid references public.timecards(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('parent', 'tutor', 'staff')),
  cancel_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_tutoring_sessions_tutor_start
  on public.tutoring_sessions(tutor_id, starts_at);
create index if not exists idx_tutoring_sessions_engagement
  on public.tutoring_sessions(engagement_id);
create index if not exists idx_tutoring_sessions_status_start
  on public.tutoring_sessions(status, starts_at);
create index if not exists idx_tutoring_sessions_student
  on public.tutoring_sessions(student_id);

-- Close the loop: invoice lines point at sessions (guarded add for re-runs).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tutoring_invoice_lines_session_id_fkey'
  ) then
    alter table public.tutoring_invoice_lines
      add constraint tutoring_invoice_lines_session_id_fkey
      foreign key (session_id) references public.tutoring_sessions(id) on delete set null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Families: billing preferences (the "mom's assistant" requirement) +
--    per-family Google-invite opt-out (spec §3, §10.5). billing_email is a
--    DELIVERY address only — parent_email remains the parent's RLS identity.
-- -----------------------------------------------------------------------------
alter table public.families
  add column if not exists billing_email text;
alter table public.families
  add column if not exists billing_cc_emails text[] not null default '{}';
alter table public.families
  add column if not exists autopay boolean not null default false;
alter table public.families
  add column if not exists stripe_customer_id text;
alter table public.families
  add column if not exists stripe_payment_method_id text;
alter table public.families
  add column if not exists billing_notes text;    -- staff-only by policy shape: parents read their
                                                  -- family row already, so keep sensitive detail out;
                                                  -- staff UI is the only writer/reader in practice
alter table public.families
  add column if not exists timezone text;         -- null = fall back tutor tz, then America/Denver
alter table public.families
  add column if not exists gcal_invite_attendees boolean not null default true;

-- -----------------------------------------------------------------------------
-- 7. Google Calendar connection + push queue (spec §4)
-- -----------------------------------------------------------------------------
-- Service-account JSON key, AES-256-GCM encrypted by the app before insert
-- (same scheme as QBO tokens). Singleton via constant primary key. RLS on,
-- ZERO policies: only service-role server code reads it; the admin UI sees
-- status through /api/gcal/status, never the table.
create table if not exists public.gcal_connection (
  id integer primary key default 1 check (id = 1),
  sa_json_enc text not null,
  client_email text,                      -- display only (which SA is connected)
  connected_by text,
  connected_at timestamptz not null default now(),
  status text not null default 'connected'
    check (status in ('connected', 'disconnected')),
  updated_at timestamptz not null default now()
);

alter table public.gcal_connection enable row level security;
-- No policies on purpose (qbo_connection pattern).

-- Push queue: one PENDING row per session ("sync this session to Google").
-- The worker is state-driven — it derives create/patch/delete from the
-- session row and gcal_event_id at run time — so enqueues coalesce naturally
-- under the partial unique index. Claim/backoff mirrors qbo_sync_log.
create table if not exists public.gcal_sync_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  reason text,                            -- human-readable trigger, for the log panel
  status text not null default 'pending'
    check (status in ('pending', 'synced', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  gcal_event_id text,                     -- result of the synced action
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

create unique index if not exists gcal_sync_log_pending_session
  on public.gcal_sync_log(session_id) where status = 'pending';
create index if not exists idx_gcal_sync_log_status
  on public.gcal_sync_log(status, next_attempt_at);

alter table public.gcal_sync_log enable row level security;

drop policy if exists "staff read" on public.gcal_sync_log;
create policy "staff read" on public.gcal_sync_log
  for select to authenticated
  using (public.is_staff());
-- Writes: service role only (enqueue on confirm/change, worker, retry route).

-- -----------------------------------------------------------------------------
-- 8. RLS helpers
-- -----------------------------------------------------------------------------
-- Instructor rows owned by the signed-in email (the tutor-side analog of
-- instructor_class_ids(); security definer so policies don't recurse).
create or replace function public.own_instructor_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select id from public.instructors
  where lower(email) = public.jwt_email()
$$;

-- "Billed" = any of the engagement's sessions sit on an invoice that reached
-- money (or has a Stripe id). Guards engagement/session deletion the way
-- family_has_payment_history guards families.
create or replace function public.engagement_has_billing(eid uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tutoring_sessions ts
    join public.tutoring_invoices i on i.id = ts.invoice_id
    where ts.engagement_id = eid
      and (i.stripe_payment_intent_id is not null
           or i.stripe_invoice_id is not null
           or i.status in ('invoiced', 'paid', 'past_due'))
  )
$$;

grant execute on function
  public.own_instructor_ids(),
  public.engagement_has_billing(uuid)
to authenticated, anon;

-- Family payment history now includes tutoring money, so the Phase 3.1
-- delete guard keeps protecting families whose only payments are tutoring.
create or replace function public.family_has_payment_history(fid uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    join public.enrollments e on e.student_id = s.id
    where s.family_id = fid
      and (e.stripe_payment_intent_id is not null
           or e.payment_status in ('Paid', 'Completed', 'Refunded'))
  )
  or exists (
    select 1 from public.tutoring_invoices i
    where i.family_id = fid
      and (i.stripe_payment_intent_id is not null
           or i.stripe_invoice_id is not null
           or i.status in ('invoiced', 'paid', 'past_due'))
  )
$$;

-- -----------------------------------------------------------------------------
-- 9. RLS policies
-- -----------------------------------------------------------------------------
alter table public.tutoring_engagements enable row level security;
alter table public.tutoring_sessions enable row level security;
alter table public.tutoring_invoices enable row level security;
alter table public.tutoring_invoice_lines enable row level security;
alter table public.timecards enable row level security;

-- Engagements: staff CRUD with billed-delete guard; tutor + parent read own.
drop policy if exists "staff read" on public.tutoring_engagements;
create policy "staff read" on public.tutoring_engagements
  for select to authenticated using (public.is_staff());
drop policy if exists "staff insert" on public.tutoring_engagements;
create policy "staff insert" on public.tutoring_engagements
  for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update" on public.tutoring_engagements;
create policy "staff update" on public.tutoring_engagements
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete unless billed" on public.tutoring_engagements;
create policy "staff delete unless billed" on public.tutoring_engagements
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and not public.engagement_has_billing(id))
  );
drop policy if exists "tutor own engagements" on public.tutoring_engagements;
create policy "tutor own engagements" on public.tutoring_engagements
  for select to authenticated
  using (tutor_id in (select public.own_instructor_ids()));
drop policy if exists "parent own engagements" on public.tutoring_engagements;
create policy "parent own engagements" on public.tutoring_engagements
  for select to authenticated
  using (student_id in (select public.family_student_ids()));

-- Sessions: staff CRUD; deleting a session on a sent/paid invoice is
-- admin-only (spec §3: void/adjust instead). Tutor writes arrive with 7b.
drop policy if exists "staff read" on public.tutoring_sessions;
create policy "staff read" on public.tutoring_sessions
  for select to authenticated using (public.is_staff());
drop policy if exists "staff insert" on public.tutoring_sessions;
create policy "staff insert" on public.tutoring_sessions
  for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update" on public.tutoring_sessions;
create policy "staff update" on public.tutoring_sessions
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete unless invoiced" on public.tutoring_sessions;
create policy "staff delete unless invoiced" on public.tutoring_sessions
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and not exists (
      select 1 from public.tutoring_invoices i
      where i.id = invoice_id
        and (i.stripe_payment_intent_id is not null
             or i.stripe_invoice_id is not null
             or i.status in ('invoiced', 'paid', 'past_due'))
    ))
  );
drop policy if exists "tutor own sessions" on public.tutoring_sessions;
create policy "tutor own sessions" on public.tutoring_sessions
  for select to authenticated
  using (tutor_id in (select public.own_instructor_ids()));
drop policy if exists "parent own sessions" on public.tutoring_sessions;
create policy "parent own sessions" on public.tutoring_sessions
  for select to authenticated
  using (student_id in (select public.family_student_ids()));

-- Invoices: staff read/insert/update, admin-only delete (void, don't delete);
-- parents read their own family's.
drop policy if exists "staff read" on public.tutoring_invoices;
create policy "staff read" on public.tutoring_invoices
  for select to authenticated using (public.is_staff());
drop policy if exists "staff insert" on public.tutoring_invoices;
create policy "staff insert" on public.tutoring_invoices
  for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update" on public.tutoring_invoices;
create policy "staff update" on public.tutoring_invoices
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "admin delete" on public.tutoring_invoices;
create policy "admin delete" on public.tutoring_invoices
  for delete to authenticated using (public.is_admin());
drop policy if exists "parent own invoices" on public.tutoring_invoices;
create policy "parent own invoices" on public.tutoring_invoices
  for select to authenticated
  using (family_id in (select public.family_ids()));

-- Invoice lines: staff manage while the invoice is still editable; once it
-- reached money, line deletes are admin-only. Parents read via their invoice.
drop policy if exists "staff read" on public.tutoring_invoice_lines;
create policy "staff read" on public.tutoring_invoice_lines
  for select to authenticated using (public.is_staff());
drop policy if exists "staff insert" on public.tutoring_invoice_lines;
create policy "staff insert" on public.tutoring_invoice_lines
  for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update" on public.tutoring_invoice_lines;
create policy "staff update" on public.tutoring_invoice_lines
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete unless invoiced" on public.tutoring_invoice_lines;
create policy "staff delete unless invoiced" on public.tutoring_invoice_lines
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and not exists (
      select 1 from public.tutoring_invoices i
      where i.id = invoice_id
        and (i.stripe_payment_intent_id is not null
             or i.stripe_invoice_id is not null
             or i.status in ('invoiced', 'paid', 'past_due'))
    ))
  );
drop policy if exists "parent own invoice lines" on public.tutoring_invoice_lines;
create policy "parent own invoice lines" on public.tutoring_invoice_lines
  for select to authenticated
  using (
    invoice_id in (
      select i.id from public.tutoring_invoices i
      where i.family_id in (select public.family_ids())
    )
  );

-- Timecards: staff full CRUD; tutors read their own (confirm-update lands
-- with 7b's bounded rules). No parent access — and no pay data exists here.
drop policy if exists "staff all" on public.timecards;
create policy "staff all" on public.timecards
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "tutor own timecards" on public.timecards;
create policy "tutor own timecards" on public.timecards
  for select to authenticated
  using (tutor_id in (select public.own_instructor_ids()));

-- PostgREST: pick up the new tables/columns/functions
notify pgrst, 'reload schema';
