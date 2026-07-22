# Portal fixes — batch 11 (July 2026, follows batch 10)

One feature, three items: instructors stop being out of the loop. Motivating reports (Scarlett): instructors don't know enrollment counts, check the public website for the calendar, and don't know what families have been told — so they sometimes send their own (occasionally conflicting) start-date/class-link emails. All three decisions below are Scarlett's (made Jul 22). Continues PL-x numbering.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · `git push` after committing · PL-x IDs in commits · check items off here when shipped · new templates get realistic samples (PL-56) and regress:links coverage · count strings use the PL-73 format ("6 enrolled / 8 min / 15 cap").

**Natural safety gate:** instructors currently have **no email addresses on file** (deliberate — Scarlett's call at roster seeding). Everything below can ship live: nothing sends until she adds an instructor's email. When an email is added, do a one-time idempotent backfill for that instructor's current assignments (welcome email + calendar attendee + digest enrollment).

---

## PL-77 · Instructor view: count, calendar, and the family-comms timeline ✅

> **Shipped, browser-verified as a signed-in instructor.** The class card now leads with the live count in the PL-73 format ("2 enrolled / 8 min / 15 cap"), a minimum-met/below-minimum line, and "registration closes {date}" while the window is open. The session calendar was already in the view; the subscribe/.ics path rides its calendar-page link (same one families get). New **"Family emails — sent & upcoming"** section: every family-facing email for the class, grouped one line per email step per day with the family count, badges for sent / upcoming (projector rows) / cancelled, each expanding to a read-only render in a sandboxed frame — served by a new instructor-scoped preview endpoint (assigned instructor of that class or staff only; composed-at-send emails fall back to subject-only with an honest note). Verified live: 20-item timeline on ISD with 8 upcoming and 8 cancelled, preview opened to the exact family render. Read-only throughout — no admin controls.

The instructor's class page becomes the answer to "what's going on with my class?":

- **Live enrollment line** — "6 enrolled / 8 min / 15 cap", plus registration deadline while the window is open.
- **Session calendar** — full schedule in the view, with the same subscribe/.ics link families get.
- **Comms timeline** — every family-facing email for this class: sent (from `email_sends`, class-scoped) and upcoming (from the sequence projector), in order, each openable to a read-only render of exactly what families saw/will see. Cancelled sends show as cancelled. This is the root fix for duplicate instructor emails: "families already got the classroom + start date Tuesday" is visible before the instructor's reflex to write one.
- Read-only; no admin controls leak into the instructor view.

## PL-78 · Instructor emails: assignment welcome, weekly digest + milestone pings, FYI logistics copies ✅

> **Shipped, E2E 13/13 — with one deliberate deviation from the doc's safety gate.** The doc assumed instructors had no emails on file; in reality all 20 rows carry their login emails, so "ship live" would have started emailing everyone on deploy. The intended gate is now explicit: **`instructors.comms_enabled` (default OFF, migration applied)** — a toggle on the admin Instructors panel. Flipping it ON is the "email added" backfill moment (immediate server-side welcome + calendar backfill; the hourly cron converges anything else). Nothing sends while it's off — verified.
> The three templates are registered (Tutors & staff group, from info@, code-copy drafts with realistic samples, regress:links-covered): **IN_WELCOME** (class summary, count, schedule, calendar subscribe link, instructor-view button, the expectations line) sent once per class×instructor by the cron pass — which IS the backfill; **IN_DIGEST** Mondays while registration is open with the "{className}: N enrolled / min / cap · registration closes · first session" line, **plus instant milestone pings** from the payment webhook (min met 🎉 / class full) and the cron (registration closed, final count) — same template, variant line, distinct dedupe keys, all verified idempotent; **IN_FYI** wraps the family render's extracted body under the "FYI — this was just sent to your {className} families. Nothing for you to do." banner, hooked at #4/#5 (sequence), SU (schedule updates), and CX (cancel route), deduped per template per class per day — verified exactly one copy per batch. Diagnostic/payment/upsell emails excluded per Scarlett's call (still visible in the PL-77 timeline).

Three registered templates (Tutors & staff group, from info@, editable, realistic samples):

- **IN_WELCOME — class assignment.** On assignment (with email on file): class summary, schedule, calendar subscribe link, link to their instructor view, and one line setting expectations: "You'll get a weekly enrollment update while registration is open, and an FYI copy whenever we send your families logistics emails."
- **IN_DIGEST — weekly while registration is open** (daily cron, fires Mondays), stopping at class start: "{className}: 6 enrolled / 8 min / 15 cap · registration closes {date} · first session {firstSessionDate}" + view link. **Plus instant milestone pings** (event-driven at registration/webhook time, PL-51 pattern, same template with a variant line): minimum met · class full · registration closed (final count). Quiet weeks stay quiet; big moments arrive immediately.
- **IN_FYI — logistics copies.** When **#4 class details, #5 location reminder, SU schedule update, or CX cancellation** goes to a class's families, the assigned instructor gets ONE copy (not per-family — dedupe per template per class batch) of the same render wrapped with a banner: "FYI — this was just sent to your {className} families. Nothing for you to do." Diagnostic/payment/upsell emails deliberately excluded (still visible in the PL-77 timeline). Scarlett chose logistics-only.

## PL-79 · Class sessions on the instructor's own calendar ✅

> **Shipped with a premise correction: class sessions had NO existing GCal events** (only tutoring sessions do), so there was nothing to add an attendee to. Equivalent outcome, same guarantees: events are **created directly on the instructor's own calendar** via the same delegated service-account machinery tutoring uses — no attendees → `sendUpdates=none` (zero invite noise; IN_WELCOME is what tells them to look, and it carries the subscribe/.ics link as the backup path). Sessions store the event id + owning email (migration applied); the hourly sweep converges: creates missing events, patches drifted ones (time/location edits flow through), and removes an instructor's future events on reassignment or comms-off — past sessions never touched. E2E against Billy's real Workspace calendar: events created for both sessions, ids stable across re-runs, removed cleanly on disable.

- Add the instructor (email on file) as an **attendee on the existing class-session GCal events** so sessions appear in their calendar and edits flow through automatically. Use `sendUpdates: 'none'` — events appear without invite-email noise (§10.5 lesson: never blast attendees); the IN_WELCOME email is what tells them to look.
- Include the subscribe/.ics link in IN_WELCOME as the backup path (Scarlett chose invite + link).
- Idempotent: re-running assignment/backfill never duplicates attendees; unassigning an instructor removes them from future events.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-29.md` (batch 11 — three items, all decided).
>
> PL-77: instructor class view gets the live "N enrolled / min / cap" line, the session calendar + subscribe link, and a read-only family-comms timeline (sent from email_sends, upcoming from the projector, each openable to the rendered email). PL-78: three registered instructor templates — IN_WELCOME on assignment, IN_DIGEST weekly-while-registration-open on the daily cron plus instant milestone pings (min met / full / closed, PL-51 event-driven pattern), and IN_FYI single-copy wraps of #4/#5/SU/CX sends with the "FYI — nothing for you to do" banner, deduped per class batch. PL-79: instructor as attendee on existing class GCal events with sendUpdates:'none', idempotent add/remove, subscribe link in the welcome. Note the safety gate: instructors have no emails on file yet — ship live, backfill idempotently when an email is added. Realistic samples, regress:links coverage, PL-73 count format throughout.
>
> Rules: PL-x IDs in commits; `git push` after committing; standing copy rules apply; check items off here when shipped.
