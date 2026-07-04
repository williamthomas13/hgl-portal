-- =============================================================================
-- HGL Portal: "Completed" enrollment status
-- =============================================================================
-- The hourly sweep flips Paid -> Completed the day after a class's last
-- session. Post-class emails (review request, tutoring offer) target
-- Paid and Completed alike.
-- =============================================================================

alter table public.enrollments
  drop constraint if exists enrollments_status_check;

alter table public.enrollments
  add constraint enrollments_status_check
  check (payment_status in ('Pending', 'Paid', 'Completed', 'Expired', 'Waitlisted'));
