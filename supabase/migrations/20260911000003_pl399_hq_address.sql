-- PL-399: the HQ address, one wording everywhere — Scarlett confirmed
-- "380 W. Pierpont Avenue, Salt Lake City, UT 84101 USA" (zip 84101; the
-- collateral letterhead had been printing 84109). app_settings is the email
-- footer's live source (PL-64); the code fallback + maps resolver +
-- letterhead now share HGL_HQ_ADDRESS. Idempotent.

insert into app_settings (key, value)
values ('business_address', '380 W. Pierpont Avenue, Salt Lake City, UT 84101 USA')
on conflict (key) do update set value = excluded.value;
