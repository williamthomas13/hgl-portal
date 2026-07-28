-- PL-197: a package overdraw can be ACKNOWLEDGED (Kelsie had the
-- conversation; the extra hours are intentional and billing). The dashboard
-- row clears while over <= acknowledged and returns if the overage grows
-- past what was acknowledged. Idempotent.
alter table tutoring_engagements
  add column if not exists overdraw_ack_hours numeric;
