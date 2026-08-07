-- PL-283: per-tutor calendar color — matches Kelsie's existing Google
-- Calendar color-coding so portal calendars read the same as the calendar
-- she already runs. Hex from the Google Calendar palette (admin-editable
-- swatch picker in the instructor editor; null = stable auto-assigned).
-- Idempotent.

alter table public.instructors add column if not exists calendar_color text;

alter table public.instructors drop constraint if exists instructors_calendar_color_check;
alter table public.instructors add constraint instructors_calendar_color_check
  check (calendar_color is null or calendar_color ~* '^#[0-9a-f]{6}$');

comment on column public.instructors.calendar_color is
  'PL-283: per-tutor calendar color (hex, Google Calendar palette). Null = auto-assigned a stable unused palette color.';

notify pgrst, 'reload schema';
