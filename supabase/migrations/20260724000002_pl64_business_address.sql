-- PL-64: HGL's postal address for the shared email footer (CAN-SPAM for the
-- promotional sends; trust signal for the rest). Settings-backed so an
-- office move is an edit, not a deploy. "USA" on purpose — many recipients
-- are international school families. Idempotent.

insert into public.app_settings (key, value) values
  ('business_address', '380 W. Pierpont Ave, Salt Lake City, UT 84101, USA')
on conflict (key) do nothing;
