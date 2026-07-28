-- PL-201: the registry gains the marketing category (campaign templates) and
-- the offers@ from-identity value. Deliberately additive — existing rows and
-- their constraints are untouched otherwise. Idempotent.
alter table email_templates drop constraint if exists email_templates_category_check;
alter table email_templates add constraint email_templates_category_check
  check (category in ('transactional', 'relationship', 'marketing'));
alter table email_templates drop constraint if exists email_templates_from_identity_check;
alter table email_templates add constraint email_templates_from_identity_check
  check (from_identity in ('info', 'billy', 'marketing'));
