# Phase 7d Launch Runbook — Parent Tutoring Surface

Companion to docs/PHASE7_SPEC.md §8. Small phase: the parent portal grows a
1-on-1 tutoring section; the only new state is the reschedule-request flag.

## 1. Apply the migration — BEFORE deploying the code

`supabase/migrations/20260718000001_phase7d_parent.sql` (idempotent; two
columns on tutoring_sessions, no new tables/policies). Security Advisor
check after, per the standing rule.

## 2. What shipped

- **/portal parent view** gains a "1-on-1 tutoring" section (only for
  families with engagements or invoices): per-student cards (subject, tutor
  first name, weekly slots, next session, location, package hours
  purchased/remaining — the comms-spec C3 widget, un-stubbed), upcoming
  sessions with **request-a-change** (≥24h = free; <24h shows the $40/hour
  policy first, requests route to the Ops Director either way — an alert
  email lands with the notice classification), a **pending-proposal banner**
  linking the signed schedule page, **billing history** with pay/receipt
  links, and the **autopay** set-up/manage link. Human-help block throughout.
- **Per-family tutoring calendar feed**: add-to-calendar + webcal subscribe
  links (signed token, confirmed sessions, reschedules propagate on
  re-fetch).
- **Admin**: sessions with an open family request show ⟳ on the schedule
  grid and the request note in the session dialog; executing the reschedule
  sends T3 to family + tutor automatically (7c wiring).

## 3. QA script

1. Sign in as the QA parent → /portal: tutoring section shows the Roman ×
   SAT card, September sessions, paid September invoice, autopay pitch.
2. Request a change on a far-out session → "free" copy, Ops alert arrives,
   ⟳ appears in /admin/tutoring, dialog shows the note; reschedule it →
   T3 lands.
3. Request a change on a <24h session (make a one-off) → $40/hour copy
   shows before sending.
4. Subscribe to the calendar feed link in Google Calendar → September
   sessions appear.
