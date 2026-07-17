-- =============================================================================
-- HGL Portal — PL-50: configurable tutoring point-of-contact
-- =============================================================================
-- The §8 contact block already reads contact_email / contact_phone from
-- app_settings; this adds contact_name and seeds the real values explicitly
-- so nothing relies on code fallbacks. Editing is admin-only (the manager
-- role must not reassign who the contact is — ownership decision), enforced
-- by the /api/admin/contact-settings route; the PL-40/41 schedule emails use
-- name + email as their From identity.
--
-- IDEMPOTENT: safe to re-run; never clobbers an edited value.
-- =============================================================================

insert into public.app_settings (key, value) values
  ('contact_name',  'Kelsie Rank'),
  ('contact_email', 'kelsie@highergroundlearning.com'),
  ('contact_phone', '+1 (801) 524-0817')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
