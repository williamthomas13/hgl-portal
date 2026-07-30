-- PL-232: billing address on the family record — collected optionally at
-- intake, viewable/editable on the Family profile's Household section
-- (admin AND manager; it's contact info, not an owner-level corner). One
-- jsonb column: { street, city, region, country } — region carries
-- "state/region + postal" as the family typed it. No QBO auto-sync yet; the
-- bookkeeper copies it when creating the QBO customer.
alter table families
  add column if not exists address jsonb;
