-- PL-273: the hourly sweep moves off GitHub Actions' best-effort scheduler
-- (Aug 6 outage: two runner-acquisition failures + a 5-hour scheduling gap).
-- Supabase pg_cron becomes the PRIMARY trigger — independent of both GitHub
-- and Vercel, real timing. This migration only enables the extensions; the
-- actual cron.schedule rows carry the CRON_SECRET bearer header and are
-- therefore created by scripts/setup-pl273-pg-cron.mjs (idempotent, reads
-- .env.local) so no secret ever lands in a committed file. Idempotent.

create extension if not exists pg_cron;
create extension if not exists pg_net;
