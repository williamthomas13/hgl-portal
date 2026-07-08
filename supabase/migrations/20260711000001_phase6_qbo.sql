-- =============================================================================
-- HGL Portal Phase 6: QuickBooks Online integration (docs/PHASE6_SPEC.md)
-- =============================================================================
-- Every successful Stripe payment becomes a QBO Sales Receipt; Stripe-dashboard
-- refunds become QBO Refund Receipts. The portal never blocks checkout on QBO:
-- the Stripe webhook enqueues qbo_sync_log rows and a worker (immediate
-- after()-trigger + hourly sweep) drains them.
--
-- Security posture (Phase 3 pattern):
--   * qbo_connection holds encrypted OAuth tokens — RLS on, ZERO policies.
--     Only service-role server code (app/utils/qbo.ts) touches it; the admin
--     UI sees connection status through /api/qbo/status, never the table.
--   * qbo_item_map: staff read (panel display), admin-only writes (spec §6 —
--     managers have no access to accounting configuration).
--   * qbo_sync_log: staff read (roster badges + sync-log panel); all writes
--     go through service-role routes/worker.
--
-- IDEMPOTENT: safe to re-run as a set (create if not exists, drop-then-create
-- policies, add column if not exists). RLS + policies live IN THIS FILE with
-- the tables they protect (July 7 process rule).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- qbo_connection: the single QBO company connection (spec §3, §6).
-- Tokens are AES-256-GCM encrypted by the app before insert; the singleton
-- shape is enforced by the constant primary key.
-- ---------------------------------------------------------------------------
create table if not exists public.qbo_connection (
  id integer primary key default 1 check (id = 1),
  realm_id text not null,
  realm_name text,
  access_token_enc text not null,
  refresh_token_enc text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  connected_by text,
  connected_at timestamptz not null default now(),
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'disconnected')),
  updated_at timestamptz not null default now()
);

alter table public.qbo_connection enable row level security;
-- No policies on purpose: anon and authenticated get nothing. Service role
-- bypasses RLS. Encrypted or not, tokens never reach a browser client.

-- ---------------------------------------------------------------------------
-- qbo_item_map: portal product key -> QBO entity (spec §3, decisions §11.1).
--   group_class     -> QBO Item posting to 408-3 International Test Prep
--   tutoring_addon  -> QBO Item posting to 408-5 International Online Prep
--   deposit_account -> QBO bank-type Account "Stripe Clearing" (spec §7) that
--                      Sales/Refund Receipts deposit to / refund from
-- qbo_name is a display snapshot for the admin panel (the id is what syncs).
-- ---------------------------------------------------------------------------
create table if not exists public.qbo_item_map (
  key text primary key check (key in ('group_class', 'tutoring_addon', 'deposit_account')),
  qbo_id text not null,
  qbo_name text,
  updated_at timestamptz not null default now()
);

alter table public.qbo_item_map enable row level security;

drop policy if exists "staff read" on public.qbo_item_map;
create policy "staff read" on public.qbo_item_map
  for select to authenticated
  using (public.is_staff());

drop policy if exists "admin all" on public.qbo_item_map;
create policy "admin all" on public.qbo_item_map
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- qbo_sync_log: one row per Stripe payment/refund that must reach QBO
-- (spec §3). The (stripe_payment_intent_id, kind) unique constraint is the
-- idempotency backbone — duplicate webhook deliveries insert-conflict away.
--   * kind 'sale' + enrollment_addon_id NULL  -> class sale (with any
--     in-checkout add-on lines, matched by the enrollment's stripe_session_id)
--   * kind 'sale' + enrollment_addon_id set   -> addon-only purchase (the #9
--     upsell page runs its own checkout with its own payment intent)
--   * kind 'refund' -> Refund Receipt; amount = cumulative refunded total from
--     charge.refunded (attribution rule in spec §5)
-- ---------------------------------------------------------------------------
create table if not exists public.qbo_sync_log (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  enrollment_addon_id uuid references public.enrollment_addons(id) on delete cascade,
  stripe_payment_intent_id text not null,
  kind text not null check (kind in ('sale', 'refund')),
  amount numeric,
  qbo_doc_id text,
  qbo_doc_number text,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

create unique index if not exists qbo_sync_log_pi_kind
  on public.qbo_sync_log (stripe_payment_intent_id, kind);
create index if not exists qbo_sync_log_enrollment
  on public.qbo_sync_log (enrollment_id);
create index if not exists qbo_sync_log_status
  on public.qbo_sync_log (status, next_attempt_at);

alter table public.qbo_sync_log enable row level security;

drop policy if exists "staff read" on public.qbo_sync_log;
create policy "staff read" on public.qbo_sync_log
  for select to authenticated
  using (public.is_staff());
-- Writes: service role only (webhook enqueue, worker, retry route).

-- ---------------------------------------------------------------------------
-- families.qbo_customer_id: cached QBO Customer match (spec §3) — the worker
-- finds-or-creates by parent email and remembers the id here.
-- ---------------------------------------------------------------------------
alter table public.families
  add column if not exists qbo_customer_id text;

-- ---------------------------------------------------------------------------
-- enrollment_addons.stripe_payment_intent_id: addon-only purchases (#9 upsell)
-- pay through their own checkout session/payment intent. Recording the PI here
-- lets charge.refunded events on those payments match back to the addon so the
-- Refund Receipt lands on the tutoring item.
-- ---------------------------------------------------------------------------
alter table public.enrollment_addons
  add column if not exists stripe_payment_intent_id text;

-- PostgREST: pick up the new tables/columns
notify pgrst, 'reload schema';
