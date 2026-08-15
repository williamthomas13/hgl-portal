-- PL-364: physical add-on products (the two notebooks) on the class
-- registration flow, fulfilled via Printful. Scope fence: class-registration
-- add-ons ONLY — no standalone store, no cart.
--
--   products        the sellable items (price-list-adjacent admin editing;
--                   sale pricing = price + regular_price COMPOSED — "$35.00,
--                   regularly $48.00" is never hand-typed into copy).
--                   printful_variant_id is the per-product variant mapping.
--   product_orders  one row per (enrollment, product) — the idempotency unit
--                   (webhook retries can't double-order). Carries the
--                   shipping address captured at checkout, the money facts
--                   frozen at purchase, and the fulfillment lifecycle:
--                   pending_payment → queued → submitted → shipped
--                   (or failed → retry / cancelled / refunded).
-- IDEMPOTENT: re-runnable.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null,
  regular_price numeric, -- NULL = not on sale; set = "…, regularly $X" composes
  active boolean not null default true,
  physical boolean not null default true,
  printful_variant_id bigint, -- Printful catalog/sync variant for fulfillment
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_orders (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity int not null default 1 check (quantity between 1 and 10),
  price_paid numeric,
  regular_price_snapshot numeric,
  ship_name text,
  ship_address1 text,
  ship_address2 text,
  ship_city text,
  ship_state text,
  ship_zip text,
  ship_country text, -- ISO-2
  stripe_session_id text,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'queued', 'submitted', 'shipped', 'failed', 'cancelled', 'refunded')),
  printful_order_id text,
  printful_status text,
  tracking_number text,
  tracking_url text,
  carrier text,
  last_error text,
  submitted_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, product_id)
);

create index if not exists product_orders_status_idx on public.product_orders (status);

comment on table public.products is
  'PL-364: physical add-on products sold on the class registration flow (Printful-fulfilled). Admin-edited beside the price list.';
comment on table public.product_orders is
  'PL-364: one row per enrollment+product — the Printful idempotency unit. pending_payment→queued (paid)→submitted (pushed)→shipped; failed rows surface on Needs Attention with a retry.';

-- Seed the two notebooks with their REAL current store prices ($35.00 each,
-- from the live Squarespace store). regular_price stays NULL — the store
-- shows them as "Sale" but the pre-sale price is Scarlett's to enter (the
-- financial-facts rule: never invent a number into copy). No Printful
-- variant ids yet — mapping happens during the sandbox round-trip; an
-- unmapped product can be sold and fails HONESTLY into the Needs Attention
-- retry once mapped.
insert into public.products (name, price, regular_price, active, physical, sort_order)
select v.name, v.price, null, true, true, v.sort_order
from (values ('WTF Spiral Notebook', 35.00, 0), ('No Cramming Spiral Notebook', 35.00, 1)) as v(name, price, sort_order)
where not exists (select 1 from public.products p where p.name = v.name);

notify pgrst, 'reload schema';
