-- PL-425: the dashboard reads ALL calendar drift from the calendar_drift
-- table instead of running Google audits inline in the request path. The
-- PL-154 XCL-retitle audit folds into the PL-180/410 audit (which already
-- lists every tutor's events — zero extra API calls) and persists here,
-- distinguished by kind; cal_title carries the retitled event's summary for
-- the dashboard row. Idempotent.
alter table calendar_drift add column if not exists kind text not null default 'time';
alter table calendar_drift add column if not exists cal_title text;
comment on column calendar_drift.kind is
  'time = event moved or deleted (PL-180 banner rows); xcl = event hand-retitled XCL- while the portal session stands (PL-154 dashboard row — resolved in the session dialog, not the banner)';
comment on column calendar_drift.cal_title is
  'kind=xcl only: the event''s current title, quoted in the dashboard row';
notify pgrst, 'reload schema';
