-- PL-189: consultations happen two ways — scheduled meetings (calendar) and
-- phone consultations that already happened (a record, not an appointment).
-- The mode is stored so surfaces can say which one it was instead of
-- guessing from a missing calendar event. Idempotent.
alter table public.leads
  add column if not exists consult_mode text
    check (consult_mode in ('scheduled', 'phone'));

comment on column public.leads.consult_mode is
  'PL-189: how the consultation happened — scheduled (calendar meeting) or phone (recorded after the fact, no calendar event).';
