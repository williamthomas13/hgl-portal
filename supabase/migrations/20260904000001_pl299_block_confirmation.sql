-- PL-299: hours-block exhaustion — the FAMILY confirms the move to standard
-- monthly 1-on-1 billing BEFORE the block runs out. State machine on the
-- engagement:
--   null      — pre-flow (legacy engagements keep PL-197 behavior exactly;
--               nothing changes until the sweep asks)
--   asked     — threshold email sent; scheduling/billing past the block HOLD
--   confirmed — family said continue: PL-197 Case-A billing applies (overflow
--               bills at the engagement rate on monthly invoices)
--   declined  — sessions stop when the hours do; overflow never bills
-- Idempotent.

alter table public.tutoring_engagements add column if not exists block_confirmation text;
alter table public.tutoring_engagements drop constraint if exists tutoring_engagements_block_confirmation_check;
alter table public.tutoring_engagements add constraint tutoring_engagements_block_confirmation_check
  check (block_confirmation is null or block_confirmation in ('asked', 'confirmed', 'declined'));
alter table public.tutoring_engagements add column if not exists block_confirmation_asked_at timestamptz;
alter table public.tutoring_engagements add column if not exists block_confirmation_at timestamptz;
alter table public.tutoring_engagements add column if not exists block_confirmation_via text;
comment on column public.tutoring_engagements.block_confirmation is
  'PL-299: hours-block exhaustion consent — null=pre-flow (legacy PL-197 behavior), asked=holds active, confirmed=continue monthly, declined=stop at the block.';

notify pgrst, 'reload schema';
