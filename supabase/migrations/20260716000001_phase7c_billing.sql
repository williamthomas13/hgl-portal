-- =============================================================================
-- HGL Portal — Phase 7c: monthly tutoring billing (docs/PHASE7_SPEC.md §6)
-- =============================================================================
-- The monthly cycle: generate on the 20th → propose (T1) → confirm/auto-
-- confirm → Stripe invoice or autopay charge → collect → QBO. This migration
-- adds: app_settings (cycle dates + the §8 contact block — pulled from
-- settings, never hardcoded), cycle-state columns on tutoring_invoices, the
-- tutoring extension of the Phase 6 QBO queue, and two new qbo_item_map keys
-- (test-prep tutoring → income 408-1, subject tutoring → 401 — the
-- bookkeeper creates/confirms the QBO Items; the portal maps to Item IDs
-- only, same pattern as Phase 6 §11.1).
--
-- Phase 6 pause-point note: qbo_sync_log changes are ADDITIVE (kind value,
-- nullable column); existing sale/refund rows and the live worker paths are
-- untouched.
--
-- IDEMPOTENT: safe to re-run as a set.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. app_settings: operational key/value store
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "staff all" on public.app_settings;
create policy "staff all" on public.app_settings
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

insert into public.app_settings (key, value) values
  ('tutoring_generate_day', '20'),        -- §10.4: generate on the 20th
  ('tutoring_nudge_days', '2'),           -- T1b at +2 days
  ('tutoring_autoconfirm_days', '5'),     -- auto-confirm at +5 days
  ('contact_email', 'kelsie@highergroundlearning.com'), -- §8 human-help block
  ('contact_phone', '+1 (801) 524-0817')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. tutoring_invoices: cycle state
-- -----------------------------------------------------------------------------
alter table public.tutoring_invoices
  add column if not exists proposal_sent_at timestamptz;      -- T1 sent (nudge/auto-confirm anchor)
alter table public.tutoring_invoices
  add column if not exists nudge_sent_at timestamptz;         -- T1b sent
alter table public.tutoring_invoices
  add column if not exists confirmed_at timestamptz;
alter table public.tutoring_invoices
  add column if not exists auto_confirmed boolean not null default false;
alter table public.tutoring_invoices
  add column if not exists change_request_note text;          -- parent "request changes" text
alter table public.tutoring_invoices
  add column if not exists change_requested_at timestamptz;   -- cleared when staff mark handled
alter table public.tutoring_invoices
  add column if not exists stripe_hosted_invoice_url text;
alter table public.tutoring_invoices
  add column if not exists charge_attempts integer not null default 0;  -- autopay dunning (3 over a week)
alter table public.tutoring_invoices
  add column if not exists next_charge_at timestamptz;
alter table public.tutoring_invoices
  add column if not exists reminder_sent_at timestamptz;      -- +10 days past due
alter table public.tutoring_invoices
  add column if not exists late_fee_flagged_at timestamptz;   -- +30 days: staff applies the 10% line

create index if not exists idx_tutoring_invoices_status
  on public.tutoring_invoices(status, due_at);

-- -----------------------------------------------------------------------------
-- 3. qbo_sync_log: tutoring revenue rides the Phase 6 pipeline (spec §6.4)
-- -----------------------------------------------------------------------------
alter table public.qbo_sync_log
  alter column enrollment_id drop not null;
alter table public.qbo_sync_log
  add column if not exists tutoring_invoice_id uuid
  references public.tutoring_invoices(id) on delete cascade;

alter table public.qbo_sync_log drop constraint if exists qbo_sync_log_kind_check;
alter table public.qbo_sync_log
  add constraint qbo_sync_log_kind_check
  check (kind in ('sale', 'refund', 'tutoring_sale'));

-- Every row belongs to exactly one revenue source.
alter table public.qbo_sync_log drop constraint if exists qbo_sync_log_source_check;
alter table public.qbo_sync_log
  add constraint qbo_sync_log_source_check
  check (
    (enrollment_id is not null and tutoring_invoice_id is null)
    or (enrollment_id is null and tutoring_invoice_id is not null)
  );

create index if not exists qbo_sync_log_tutoring_invoice
  on public.qbo_sync_log (tutoring_invoice_id);

-- -----------------------------------------------------------------------------
-- 4. qbo_item_map: two tutoring revenue items (bookkeeper creates in QBO)
-- -----------------------------------------------------------------------------
alter table public.qbo_item_map drop constraint if exists qbo_item_map_key_check;
alter table public.qbo_item_map
  add constraint qbo_item_map_key_check
  check (key in (
    'group_class', 'tutoring_addon', 'deposit_account',
    'tutoring_test_prep',   -- Item posting to 408-1 (SAT/ACT/GRE/GMAT/etc. 1-on-1)
    'tutoring_subject'      -- Item posting to 401 (ongoing subject help)
  ));

-- PostgREST: pick up the new table/columns
notify pgrst, 'reload schema';
