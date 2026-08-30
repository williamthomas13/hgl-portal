# Payroll CSV — bookkeeper one-pager (PL-412, Aug 29 2026)

The Admin → Tutoring → Timecards page exports one CSV per pay period
(`hgl-timecards-{period_start}.csv`). One row per approved timecard.
Batches 22 and 42 both flagged that this document must change in lockstep
with the export — it lives here so it finally can.

## Columns

| Column | Meaning |
|---|---|
| `tutor` | The tutor's name (quoted). |
| `period_start` / `period_end` | The Denver payroll calendar period (dates). |
| `session_hours` | Hours from sessions taught (1-on-1, Test Prep, 2-on-1, Class/Workshop, pay-type titles). **New in PL-412.** |
| `prep_hours` | Per-session prep time, summed — pays under the **Prep Time** pay type. **New in PL-412.** |
| `total_hours` | `session_hours + prep_hours` — same meaning as before PL-412 (prep simply used to be invisible). |
| `pay_type` | `hourly`, or `SALARIED — do not pay hourly` (salaried rows sort LAST so they can't be swept in by momentum — PL-212). |

## Rules that don't change

- Only **approved** timecards export; the export marks them `exported`.
- Rates and dollar amounts never appear — titles/hours only; rates live in
  QBO Payroll.
- The per-work-type breakdown (Test Prep / 1-on-1 / Prep Time / …) is on the
  payroll-summary clipboard and in the QBO TimeActivity note, not in the CSV.

## Where prep time comes from

Tutors record prep minutes per session on their timecard ("Prep time"
checkbox → minutes; more than 15 min/session is uncommon and the portal says
so, softly). Admin sees it on the timecard review; it feeds `prep_hours`
here and the "Prep Time" line everywhere hours-by-type renders.
