# Portal fixes — batch 22 (🚧 OPEN — accumulating, do not start yet)

Opened July 29, empty. Scarlett will say when it's ready to pull; if extended after you've pulled it, wait for an explicit re-read ask.

Next PL after this batch: **PL-216**.

**Decisions noted Jul 28:** campaigns work (PL-201 copy/rollout) is PUNTED for now — no campaign sends; campaign identity should use existing aliases hello@ or testprep@ (both exist) rather than creating offers@ (tell Code before campaigns resume).

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

---

## PL-207 — Parent-portal 1-on-1 tutoring card: make it do work in every state (reported Jul 28, view-as parent / Scar Tissue QA fixture)

Today the card is one static state: "1-on-1 tutoring: 10 hours purchased" + a vague "appears below once your schedule is set up" line. Rebuild it as a state machine over (add-on purchased? x class not-started / in-session / finished):

**A. Purchased add-on, class not yet finished (the screenshot state):**
- Short parent-facing explanation: 1-on-1 hours are most valuable AFTER the class ends (tailored to diagnostic results + instructor input), plus the concrete steps to redeem them: share availability -> we propose a schedule -> confirm -> sessions begin.
- Let the parent **share availability right from this card now** (reuse the existing tokenized availability page/machinery — do not build a second availability form). Submitting notifies ops (Needs Attention row), so families who happen to be in the portal can get ahead of the queue.
- **Timing toggle for the parent** (visible as long as class sessions are still running): "start 1-on-1 right away" vs "wait until the class is done." Choice is stored and shown to Kelsie so it is unambiguous whether the family wants immediate scheduling or is just completing the paperwork early.
  - If "wait until after class": one-click for Kelsie to **push it to her to-dos** with suggested due date = last day of the class (deep-links the family, per standing rule).
  - If "start right away": normal immediate-scheduling path / Needs Attention.
- **Email suppression:** if the parent completes this flow in the portal, suppress the planned post-class tutoring-kickoff emails for this engagement (the availability-request sequence they would otherwise get after the final session). Suppression check lives inside the send function, not at call sites (standing lesson). Post-class offer emails for NON-purchasers are unaffected.

**B. No add-on purchased, class not yet started:**
- Card shows the same pre-class add-on reminder specced for the registration add-on page / email #9: discounted packages with savings ({pkgHours} — save {pkgSavings}), "savings only available before class starts," buy link = existing {addonLink} which already honors pre_class pricing until {firstSessionDate}. A standing in-portal reminder that the deal exists, with a way to take it.

**C. No add-on, class in session:**
- Deal is gone; card reads approximately: "You didn't sign up for 1-on-1 tutoring, but students who take the {schoolNickname} {classType} class are eligible for discounted 1-on-1 hours after it ends. Look out for an email from us after the class finishes — or get in touch now if you'd like to chat." (Parent-facing, no internal shorthand.)

**D. No add-on, class finished:**
- Card mirrors the post-class offer email (#8): discounted post-class hours + link to the discount page, same post_class pricing source. Card and email must read the same pricing data so they cannot disagree.

Sample every state through the real composer/preview path before calling it done. QA note: Scar Tissue / Bruce Bruce fixture is intentional — verify with it, don't "fix" it.

## PL-208 — Nothing ever tells parents the portal exists (reported Jul 28)

Portal discovery today is only deep-links inside task emails (#0 "View your registration", T1 schedule page, availability page, receipts). No email or surface says "you have a family portal, here's what's in it, log in any time with just your email." Fix candidates (scope with Code):
- A short "your family portal" block in #0-parent and/or the thank-you (#1): what's there (schedule, receipts, diagnostic scores, calendar feed, tutoring), and that login is just their email — no password.
- A one-line portal pointer in the standing footer of transactional templates (transactional-safe: informational, not marketing).
- Parent-voiced, no shorthand.

## PL-209 — Tutor upcoming-sessions header copy: name the Ops Director, name the places (reported Jul 28)

Current subtext: "These also live on your Google Calendar — reschedules and cancellations go through the office, and both places update automatically." Change "the office" to the Ops Director's actual name pulled from settings (currently Kelsie) — not hard-coded — and "both places" to "your portal and Google Calendar." E.g.: "...reschedules and cancellations go through {opsDirectorFirstName}, and your portal and Google Calendar both update automatically." File: `app/portal/tutor-view.tsx`.

## PL-210 — Join buttons only live near session time (reported Jul 28)

Every session with a meeting-URL location currently shows an enabled Join button, even a week out — noise, and invites mis-clicks. Make Join active only within ~30 minutes of the session on either side (30 min before start through 30 min after end, or after start +30 — Code's call, say which). Outside the window, either hide the button or show a muted/disabled state so the tutor still knows it's an online session (muted state preferred — the online/in-person distinction is information). File: `app/portal/upcoming-sessions.tsx` (client component — window check can be client-side; no security concern, the URL is already the tutor's).

## PL-211 — Warn when an engagement is scheduled with no location anywhere (reported Jul 28)

Engagement `location` is optional and falls back to the tutor's `default_location`; when both are empty, the tutor's upcoming list shows a row with no location and no Join, and the ICS/PDF schedule surfaces have no LOCATION either. Add a warning at engagement create/edit (wizard + `app/api/admin/tutoring/engagement/route.ts` path) when the engagement has no location AND the tutor has no default: don't hard-block (some setups may be legitimately TBD), but make the admin explicitly acknowledge "no location set — tutor and family won't see where/how to meet," and surface still-missing-location engagements as a Needs Attention row (deep-linked, per standing rule) so a TBD can't silently ride into session day. Current location-less rows in QA are the Roman fixture — intentional, don't "fix" the data.

## PL-212 — Salaried tutors: track hours, don't pay hourly (reported Jul 28)

Some tutors are salaried (currently Eric) — paid the same regardless of hours tutored. We still want their sessions and timecards tracked exactly like any other tutor (scheduling, session notes, auto-completion, semi-monthly sweep, confirm/approve), but the timecard must show they are not paid hourly. Add a per-tutor pay-type flag on `instructors` (`hourly` default | `salaried`, editable in the tutors panel):

- Timecard generation/confirm/approve flows unchanged — hours are still real records.
- Salaried tutors' timecards carry a visible "Salaried — hours tracked for records; not paid hourly" label (tutor view AND staff approval view), plain English.
- The hours-only payroll CSV export must distinguish them: separate them out (own section or column flag) so the bookkeeper can't accidentally pay salaried hours as hourly. Coordinate with the bookkeeper one-pager if the export shape changes.
- Rare case, so keep it one flag — no salary amounts in the portal (rates and dollars live in QBO/payroll, standing rule).

Note: Billy and Kelsie are salaried but don't tutor, so they never generate timecards — no flag needed for non-tutors.

## PL-213 — Team access panel + access lifecycle for staff and tutors (reported Jul 28)

Today the manager role is granted by hand-editing `profiles.role` in SQL — no UI. And access lifecycle has a hole: `deriveRoles` grants the instructor role from a bare `instructors` email match with NO `active` filter, so a tutor made inactive (PL-176) or not yet flipped on (`tutoring_active=false` rollout gate) can still log in and see the tutor view. Counselors already do this right (ended affiliation = no role); instructors should match.

1. **Admin-only "Team access" panel** (under Settings): list profiles with elevated roles; grant/revoke manager on any known email; show admins read-only with a note that admin comes from the `ADMIN_EMAILS` env allowlist (the allowlist stays the admin authority — no admin-granting UI, no privilege escalation path). Every change writes an audit line.
2. **Instructor role requires `instructors.active = true`** in `deriveRoles` (and any RLS that keys off instructor identity). Making a tutor inactive revokes portal access on next auth check, exactly like ending a counselor affiliation; reactivating restores it — history intact, nothing deleted. Decide + document whether `tutoring_active=false` (rollout gate) should also withhold the tutor view or just hide tutoring features; leaning: `active` gates login, `tutoring_active` gates tutoring surfaces.
3. So the lifecycle story is uniform and self-serve: hire a tutor = add them in the tutors panel (login works immediately); offboard = make inactive (login gone); counselors = end the affiliation; managers = toggle in Team access; admins = env allowlist.

## PL-214 — Counselor "class is ready" email + sample announcement + portal line in the digest (authored Jul 28)

Fills a confirmed gap: the counselor sequence (CD, CR1-3, FP/FP-alt, CX-C) never says "your class is set up" and never mentions the portal. Replaces the manual email Billy sends today after class setup. Three pieces (final copy in the batch-22 copy appendix at the bottom of this doc — use it verbatim through the template editor):

1. **CS — Counselor class-confirmed welcome.** From William Thomas <billy@> (relationship tier). Trigger: admin-initiated send when the class is fully set up (schedule + price confirmed, registration live — instructor may still be TBD until minimum enrollment) — a button on the class admin view, not a blind automation. Attaches parent letter PDF + student flyer PDF/JPG (generated fresh at send). Body: sales-page link + deadline + first session, what each attachment is for, and the portal intro (sign in with just this email at {portalLink}; live enrollment, roster + attendance + diagnostic scores, past classes + results, always-current collateral downloads incl. formats/languages — `{collateralLanguagesPhrase}` renders only when the school has a second collateral language). Ends with the sample announcement below.
2. **SA — sample announcement block** rendered at the bottom of CS for the counselor to forward to students/parents: partnership intro, why-HGL list, outside-school-hours line, registration managed by HGL, capped at {classCapacity} FCFS, registration link + deadline, info@ for questions.
3. **CD digest addition:** one line pointing at the portal ("See live counts and scores any time — sign in at {portalLink} with this email.").

Audience test applies throughout; samples through the real composer; CS is transactional-adjacent but from billy@ — footer per the #1 thank-you pattern.

## PL-215 — Unsubscribe page: missing space after the email address (reported Jul 28)

The campaigns unsubscribe page (PL-201) renders "billy@highergroundlearning.comwill stop receiving offers..." — bold email address runs straight into "will". Add the space (and check the confirmation state + one-click POST result page for the same join).

*(Still on the radar from prior sessions: the Students-header mixed-units count ("3 students" vs "Current (4)") · duplicate identical weekly slots accepted without warning · anything from the batch-21 verification pass.)*

---

## Batch-22 copy appendix — PL-214 final copy

### CS — Counselor class-confirmed welcome
**From:** William Thomas <billy@> · **Trigger:** admin send when class fully set up · **Attachments:** parent letter PDF, student flyer PDF + JPG
**Subject:** Everything's ready for {className} at {schoolNickname}
**Preheader:** Registration is live — materials attached, and a sample announcement you can forward.

Hi {counselorFirstName},

Good news — everything is set up for the {className} class at {schoolName}. Registration is live, the course calendar is set, and families can sign up here:

[{salesPageLink}]({salesPageLink})

*({salesPageLink} = the Squarespace sales page, hgl.co/{schoolSlug} e.g. hgl.co/aisj — the sales layer; its Register button lands on the portal's Stripe registration page. NOT the raw /register/{slug} link.)*

Registration closes **{enrollmentDeadline}**, and the first session is {firstSessionDate}. I've attached the materials for you:

- A **letter** meant to be shared with parents (forward it in your parent communications, or print it)
- A **flyer** meant for students — it works well on bulletin boards, hallway screens, and in student newsletters

One more thing that makes your life easier: you have a **school portal** with Higher Ground. Sign in at [{portalLink}]({portalLink}) with just this email address — no password, we'll send you a login link. In it you'll find live enrollment for {className} (no more asking us for a count), your student roster, attendance, and diagnostic scores once the class is underway, every past class at {schoolNickname} with its results, and fresh downloads of the letter and flyer in every format{collateralLanguagesPhrase} — always reflecting the latest class details, so you never have to worry about a stale copy.

Below is a sample email you could use to introduce the course to students and parents. And as always — if you'd like any changes to the schedule or anything else, just reply. I'm happy to help however I can.

Best,

William Thomas

### SA — Sample announcement (rendered at the bottom of CS)

Greetings Students and Parents,

I have some exciting news to share: {schoolNickname} is partnering with Higher Ground Learning ([www.highergroundlearning.com](https://www.highergroundlearning.com)), a US-based test preparation company, to offer {classType} prep to our students.

We selected Higher Ground for many reasons, including excellent references from peer international schools, a long-standing record of integrity in preparing students for college admission exams, highly qualified tutors who provide both group and one-on-one support, and a teaching approach aligned with what {schoolNickname} believes is best practice.

The course runs {courseDatesPhrase}, with all sessions held outside of school hours. As this is a partnership and not a school-offered course, registration is managed directly by Higher Ground. To provide personalized attention, the class is capped at {classCapacity} students, first come, first served.

**Register here: [{salesPageLink}]({salesPageLink})** — registration closes {enrollmentDeadline}.

If you have questions about the course, feel free to reach out to Higher Ground directly at [info@highergroundlearning.com](mailto:info@highergroundlearning.com).

### CD digest — added line (after the class list block)

See live counts and scores any time — sign in at [{portalLink}]({portalLink}) with this email.
