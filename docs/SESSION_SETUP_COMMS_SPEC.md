# Session-setup comms & parent approval (PL-40 + PL-41)

**v1.0 draft — July 19, 2026.** Companion to `docs/portal-fixes-2026-07-19.md` and `docs/AVAILABILITY_MATCHING_SPEC.md` (PL-19, shipped). Builds on the now-live availability/scheduling wizard. **The email copy in §4 is a DRAFT for Scarlett's sign-off — do not ship the emails until approved.**

## Problem

Today, when a recurring tutoring schedule is created, every generated session is pushed to Google Calendar with the family as an attendee and `sendUpdates=all` (`app/utils/gcal.ts` ~line 223) — so the parent gets a separate Google invite for *each* session. A monthly generation can fire four-plus invite emails at once. That's noisy and impersonal, and it also means the schedule goes live without the family ever confirming it works for them.

## What we want

1. **PL-40 — one warm email instead of many invites.** Push sessions to the *tutor's* calendar only (no family attendees), and send the family a single friendly "regular sessions are set up" email with calendar-subscribe links and a PDF schedule. Reuses the existing ICS family feed (7d) and the PDF-schedule machinery (used for class schedules).
2. **PL-41 — propose → approve.** When Kelsie sets up a new student, a toggle (default ON) sends the proposed schedule to the parent for one-click confirmation, with a couple of gentle nudges — the same pattern as the counselor classroom-request flow. Kelsie can flip the toggle OFF to set the schedule up directly without approval (appropriate when she's already agreed it by phone).

## 1. Wizard change (PL-41)

Add to the New Student Schedule wizard, near the Create button:

- A toggle **"Send the parent this schedule to confirm"** (default ON).
  - **ON →** on Create, the engagement/sessions are created in a `pending_parent_confirmation` state, sessions are NOT yet pushed to Google, and the approval email (§4a) goes to the family with signed approve/decline links. Nudges fire on a cadence (§3). On approval → sessions push to the tutor's calendar, state → active, welcome email (§4c) fires.
  - **OFF (override) →** schedule is created active immediately, sessions push to the tutor's calendar, welcome email (§4c) fires right away. No approval email.
- Copy note under the toggle (plain English, no phase jargon): "On: we'll email the family to confirm the times before anything's locked in. Off: set it up now — use this when you've already agreed the schedule."

## 2. Google Calendar change (PL-40)

In `app/utils/gcal.ts`: for tutoring session pushes, do **not** add the family as an attendee and do **not** use `sendUpdates=all`. Push to the tutor's calendar only (the tutor still sees their sessions; the family gets the portal ICS feed + the welcome email instead). Confirm this doesn't affect the group-class calendar paths — scope the change to tutoring sessions. The family's calendar access is the existing subscribe link, which already auto-updates on changes.

## 3. Approval + nudge cadence (PL-41)

Model on the counselor classroom-request flow (tokenized action link, HMAC-signed like `proposalToken` in `tutoring-billing.ts`; re-nudge on a schedule):
- T+0: approval email (§4a).
- +2 days, no response: nudge #1 (§4b).
- +5 days, no response: nudge #2 (§4b), and alert the Ops Director that the family hasn't confirmed (so Kelsie can call). Do NOT auto-approve — a tutoring schedule shouldn't lock in silently. Kelsie can always override to active from the wizard/engagement panel.
- On approve at any point: state → active, GCal push, welcome email.
- On decline / "request different times": engagement stays pending, Ops Director alerted with the family's note so Kelsie can adjust and re-send.

## 4. Email copy — APPROVED July 19, 2026

Voice: warm, plain, human-help present. **From-identity = the configured tutoring point-of-contact (Kelsie Rank / kelsie@ today), read from the same `app_settings` contact that the contact block uses — NOT a hardcoded kelsie@.** See PL-50: the sender name + email come from the configurable setting so reassigning the contact person updates both the From line and the contact block everywhere at once. Register all three in the editable template registry (ties into PL-13).

### 4a. Approval request — `T_SCHEDULE_CONFIRM`
Subject: Please confirm {studentFirstName}'s tutoring schedule
Preheader: One quick tap to lock in the times.

> Hi {parentFirstName},
>
> We'd like to set {studentFirstName} up for regular 1-on-1 tutoring with {tutorName}. Here's the schedule we have in mind:
>
> {scheduleSummary}
>
> If that works, just confirm and we'll lock it in and add it to your calendar:
>
> [button:Confirm this schedule]({approveLink})
>
> Prefer different times, or have a question? Reply to this email or reach us — we're happy to adjust before anything's set.
>
> {contactBlock}

### 4b. Nudge — `T_SCHEDULE_CONFIRM_NUDGE`
Subject: Still holding {studentFirstName}'s tutoring times
Preheader: Just need a quick confirm when you have a moment.

> Hi {parentFirstName},
>
> Just circling back on {studentFirstName}'s proposed tutoring schedule with {tutorName}:
>
> {scheduleSummary}
>
> A quick tap confirms it and we'll add it to your calendar:
>
> [button:Confirm this schedule]({approveLink})
>
> If the times don't quite work, reply and we'll find something better.
>
> {contactBlock}

### 4c. Welcome / all-set — `T_SCHEDULE_SET`  (fires on approval, or immediately on override)
Subject: {studentFirstName}'s tutoring schedule is all set
Preheader: Here's the plan, plus calendar links so it's always in front of you.

> Hi {parentFirstName},
>
> Great news — {studentFirstName}'s 1-on-1 tutoring with {tutorName} is all set up. Here's the regular plan:
>
> {scheduleSummary}
>
> A couple of things to make life easier:
>
> [button:Add to your calendar]({calendarLink}) — subscribe once and every session (and any future change) shows up automatically.
> [button:Download the schedule (PDF)]({schedulePdfLink})
>
> You can reschedule any single session yourself from your parent portal — no need to email us for the small stuff. And if the regular time ever needs to change, just reach out and we'll take care of it.
>
> We're looking forward to working with {studentFirstName}.
>
> {contactBlock}

Variables: {parentFirstName}, {studentFirstName}, {tutorName}, {scheduleSummary} (e.g. "Mondays at 4:00 PM, starting July 21 — one hour each week"), {approveLink}, {calendarLink} (existing ICS family feed), {schedulePdfLink}, {contactBlock} (from app_settings). All times in the family's timezone.

## 5. Acceptance checklist
- [ ] Wizard toggle present, default ON; OFF path creates active + fires welcome immediately.
- [ ] ON path creates pending, no GCal push yet, approval email sent with working signed link.
- [ ] Approve → sessions appear on the tutor's Google calendar (tutor only, no family attendee/invite), state active, welcome email fires once.
- [ ] Nudges at +2/+5 days; +5 also alerts Ops Director; never auto-approves.
- [ ] No per-session Google invites reach the family in any path (PL-40).
- [ ] Welcome email's calendar link is the existing auto-updating ICS feed; PDF matches the sessions.
- [ ] All three templates editable in the registry; copy is the approved version.
- [ ] From-identity resolves from the configurable tutoring contact (PL-50), not a hardcoded address — changing the setting changes the sender.
- [ ] Copy: plain English, no phase numbers, student-centric, contact block present.
