-- PL-94: waitlist rescue. A rescued (expired/declined/rolled) family can be
-- added back at a chosen position or re-offered the spot with a fresh 48h
-- clock — so re-sends need offer ROUNDS (the original W2's dedupe key stays
-- claimed forever; a new round mints a new key and the history stays
-- honest). Over-cap re-offers are an explicit, logged Ops override.
-- Idempotent.

alter table public.enrollments
  add column if not exists waitlist_offer_round integer not null default 0;

-- {at, by, capacity, taken} — the explicit over-cap confirm, never silent.
alter table public.enrollments
  add column if not exists waitlist_overcap_override jsonb;

notify pgrst, 'reload schema';
