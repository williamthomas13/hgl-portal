-- PL-125: sibling carts — one Stripe checkout session covers N enrollments,
-- so stripe_session_id can no longer be unique. Metadata enrollment ids are
-- the webhook's primary match (the by-session fallback only serves legacy
-- single carts); a plain index keeps the lookup fast. Idempotent.

alter table public.enrollments
  drop constraint if exists enrollments_stripe_session_id_key;

create index if not exists enrollments_stripe_session_id_idx
  on public.enrollments (stripe_session_id)
  where stripe_session_id is not null;
