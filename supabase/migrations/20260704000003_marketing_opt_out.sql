-- =============================================================================
-- HGL Portal: marketing opt-out (relationship emails only)
-- =============================================================================
-- Parent-level flag. When true, the non-essential "relationship" emails are
-- suppressed for every enrollment in the family: thank-you (#1), 2nd
-- diagnostic (#6), review request (#7), tutoring offer (#8).
-- Transactional emails (Synap access, FAQs, class details, location reminder,
-- schedule updates, payment reminders, waitlist) always send.
-- =============================================================================

alter table public.families
  add column if not exists marketing_opt_out boolean not null default false;
