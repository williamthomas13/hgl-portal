-- PL-237: "Skip for now (remind me later)" on the wizard's Branding &
-- Collateral step stamps this; the Needs Attention row ("Collateral not set
-- up for {class}") is STATE-DRIVEN — it shows while the stamp is set and the
-- class still has no short link, and clears itself the moment the collateral
-- fields are completed (no bookkeeping).
alter table classes
  add column if not exists collateral_reminder_at timestamptz;
