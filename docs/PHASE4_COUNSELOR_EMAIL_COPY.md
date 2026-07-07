# HGL Portal — Phase 4 Counselor Email Copy

**Version:** 1.0 · July 6, 2026 · Companion to hgl-phase2-email-copy-deck.md
**Conventions:** same as the Phase 2 deck. `{curlyBraces}` = variables · `[Button] → destination` = CTAs · Footer **T** = transactional. All five are counselor-facing, From: info@, Footer T.
**New variables:** {counselorFirstName}, {classroomFormLink} (tokenized single-question form), {digestPrefsLink} (tokenized frequency page), {registrationLink}, {paidCount}, {capacity}, {spotsRemaining}, {waitlistDepth}, {newSinceLastDigest}, {classListBlock}, {daysToDeadline}.

---

## CR1 — Classroom Request

**Trigger:** in-person class, `classroom` blank, 14 days before first session · **Footer:** T ("You received this email because you're the school contact for this class at {schoolName}.")
**Subject:** Where will {schoolNickname} {classType} be held?
**Preheader:** One quick question — takes about 20 seconds.

Hi {counselorFirstName},

The {schoolNickname} {classType} class starts on {firstSessionDate}, and there's exactly one thing we still need before we can send families their "here's where to go" email:

**A room.**

If you can reserve a space on campus and tell us where it is, we'll handle everything else — the location goes out automatically to every registered family, onto the class calendar, and into all the reminder emails.

**[Tell us the room]** → {classroomFormLink}

It's a single question ("Room C19 in the high school" is a perfect answer) — just type it in and hit submit, and you're done.

Thanks for making this class possible!

Higher Ground Learning

---

## CR2 — Classroom Request, Re-nudge 1

**Trigger:** still blank, 11 days before · **Footer:** T (same)
**Subject:** Still need a room for {schoolNickname} {classType}
**Preheader:** Class starts {firstSessionDate} — 20 seconds fixes this.

Hi {counselorFirstName},

Just circling back — the {schoolNickname} {classType} class starts {firstSessionDate}, and we still don't have a room to tell families about.

We know reserving campus space sometimes takes a little legwork, so no stress if it's in progress. The moment you know, just drop it here:

**[Tell us the room]** → {classroomFormLink}

One question, ten seconds, and we take it from there.

Higher Ground Learning

---

## CR3 — Classroom Request, Re-nudge 2 (final)

**Trigger:** still blank, 8 days before · **Footer:** T (same)
**Subject:** Last call: room needed for {schoolNickname} {classType}
**Preheader:** Families get their location email in a few days.

Hi {counselorFirstName},

Last nudge, we promise — in a few days we're scheduled to email every registered family with the class location for {schoolNickname} {classType} (first day: {firstSessionDate}), and right now that email would say "location TBD" — we'd love to give them something better.

**[Tell us the room]** → {classroomFormLink}

If there's a snag on your end — no rooms available, room reservations are handled by someone else at your school, anything — just reply to this email and one of our team will help sort it out.

Higher Ground Learning

---

## CD — Counselor Enrollment Digest

**Trigger:** per `digest_frequency` (default weekly, Monday 8:00 AM school-local) · **Footer:** T + frequency links
**Subject:** {schoolNickname} enrollment update — {paidCount} student{s} enrolled
**Preheader:** Your students' class registrations, at a glance.

Hi {counselorFirstName},

Here's where enrollment stands for the upcoming Higher Ground Learning class{es} at {schoolName}:

{classListBlock}
*(Rendered per class:)*
**{classType} — starts {firstSessionDate}**
Enrolled: **{paidCount} of {capacity}** ({newSinceLastDigest} new since last update) · Waitlist: {waitlistDepth}
Registration link to share: {registrationLink}

Know a student who's still on the fence? Forwarding them (or their parents) the registration link is the single most helpful thing you can do — everything after the click is automatic.

Questions about any student or class? Just reply to this email.

Higher Ground Learning

*Footer: How often do you want these? [Weekly] · [Every 2 weeks] · [Monthly] · [Pause] → {digestPrefsLink}*

---

## FP — Final-Days Push (last 3 days before enrollment deadline)

**Trigger:** daily on each of the last 3 days before `enrollment_deadline` (fallback: first session date); suppressed when full — see FP-alt · **Footer:** T
**Subject:** {daysToDeadline == 1 ? "Last day" : daysToDeadline + " days left"} to register for {schoolNickname} {classType}
**Preheader:** {spotsRemaining} spot{s} left — a nudge from you goes a long way.

Hi {counselorFirstName},

Quick heads-up: registration for the {schoolNickname} {classType} class closes in **{daysToDeadline} day{s}**, and there {spotsRemaining == 1 ? "is" : "are"} still **{spotsRemaining} spot{s}** open.

This is the window where a nudge from the school makes the difference — parents who've been meaning to register usually just need one reminder, and one from you carries real weight.

Here's the link, ready to forward:

{registrationLink}

Current count: {paidCount} of {capacity} enrolled. After the deadline, late registrations may still be possible while spots remain, but the class calendar and materials go out on schedule — so sooner really is better.

Thanks for the assist!

Higher Ground Learning

---

## FP-alt — Class Full (replaces FP when capacity reached)

**Trigger:** one-off, fires instead of the FP series when paid count = capacity · **Footer:** T
**Subject:** {schoolNickname} {classType} is full 🎉
**Preheader:** Great news — and here's what to tell latecomers.

Hi {counselorFirstName},

Good news: the {schoolNickname} {classType} class is **full** — all {capacity} spots are taken. Thanks for helping spread the word!

If more students ask about it, the registration page now offers a **waitlist** ({waitlistDepth} on it so far). Spots do occasionally open up, and waitlisted families are offered them automatically, first come, first served — so it's genuinely worth joining. And if the waitlist grows large enough, we'll often try to free up another instructor and open a **second section** running alongside this one — so keep sending interested families to the link; real demand is exactly what makes that happen.

Same link as always: {registrationLink}

Higher Ground Learning

---

## Notes for implementation

- Pluralization helpers needed: {s}, {es}, is/are, day{s}, spot{s}, class{es} — render from counts.
- {classListBlock} in CD covers multiple simultaneous classes at one school; single-class schools render one block, subject uses that class's count. Multi-class schools' subject reads "{n} classes, {total} students enrolled" (decided July 6, post-v1.0) so the total can't be mistaken for one class's headcount.
- All five are transactional (no unsubscribe link); the digest's frequency links (incl. Pause) serve the control function.
--

# Addendum (July 6): Class Cancellation Templates

**New variables:** {offerHours}, {classPrice} (group class fee only — never includes add-ons), {offerSavingsPct}, {offerSavingsUsd} (computed from tutoring_packages regular rate vs {classPrice}), {nextCourseTerm} (admin free text), {tutoringOfferBlock} / {creditOfferBlock} (render only when toggled on), {addonHours}, {totalHours} (= offerHours + addonHours; add-on families only).

---

## CX — Class Cancellation (Paid enrollments)

**Audience:** both (pronoun rendering; blank student_email → parent-only silently) · **Trigger:** admin confirms cancellation · **From:** William Thomas <billy@> · **Footer:** T
**Subject:** IMPORTANT: {schoolNickname} {classType} Course Cancellation
**Preheader:** The class won't run — here are your options, including a full refund.

Hi {recipientFirstName},

Unfortunately, I'm writing with a bit of bad news: we were unable to meet the minimum number of students required to offer the {schoolNickname} {classType} class that {isStudent ? "you" : studentFirstName} signed up for. As a result, we've unfortunately had to cancel the course. I understand that this cancellation can be worrisome, and I sincerely apologize for the inconvenience.

However, I have a couple of other options for you:

{tutoringOfferBlock}
*(Renders when the tutoring offer is on — no add-on purchased:)*
1. **We can convert the group course fee of {classPrice} that you have already paid into {offerHours} 1-on-1 tutoring hours — a savings of over {offerSavingsPct} (USD {offerSavingsUsd}) from our typical fees** as our apology that we weren't able to offer the group course. This means {isStudent ? "you" : studentFirstName} would receive {offerHours} hours of 1-on-1 tutoring for {classPrice}, which is enough time to cover a lot of material and strategy and see a meaningful improvement. We would tailor the schedule to {isStudent ? "your" : "your family's"} availability and the lesson content to {isStudent ? "your" : studentFirstName + "'s"} strengths and weaknesses (according to the first diagnostic test score).

*(Add-on families render this version of item 1 instead:)*
1. **We can convert the group course fee of {classPrice} that you have already paid into {offerHours} 1-on-1 tutoring hours — a savings of over {offerSavingsPct} (USD {offerSavingsUsd}) from our typical fees** as our apology that we weren't able to offer the group course. With {isStudent ? "your" : "the"} {addonHours} discounted tutoring hours already purchased, {isStudent ? "you" : studentFirstName} would receive a total of {totalHours} hours of 1-on-1 tutoring, which would be enough time to cover a lot of material and strategy and see a very meaningful improvement. We would tailor the schedule to {isStudent ? "your" : "your family's"} availability and the lesson content to {isStudent ? "your" : studentFirstName + "'s"} strengths and weaknesses (according to the first diagnostic test score).

*(Add-on families ALSO get this reassurance line immediately after the options list, regardless of which offers are on:)*
(And just to be clear: the {addonHours} discounted 1-on-1 tutoring hours you already purchased are {isStudent ? "yours" : studentFirstName + "'s"} to keep no matter which option you choose — including a refund of the course fee.)

{creditOfferBlock}
*(Renders when the credit offer is on:)*
2. **We can apply the fee that you paid to our next {classType} course at {schoolNickname}.** That course will most likely be offered in {nextCourseTerm}.

If you prefer, of course we can also offer you a **full refund** instead. **Please let me know your preference by replying to this email — and reach out with any questions at all.**

Best,

William Thomas
Higher Ground Learning

*(Numbering renders dynamically: if only one offer is on, it appears unnumbered; refund line always present. If both offers are off, the body skips straight from the apology paragraph to: "We'll be issuing you a full refund — just reply to confirm the best way to reach you if any details are needed, and please accept our apologies again.")*

---

## CX-W — Cancellation Note (waitlisted families)

**Audience:** parent (Waitlisted) · **Trigger:** same admin confirm · **From:** info@ · **Footer:** T
**Subject:** Update on the {schoolNickname} {classType} waitlist
**Preheader:** The class won't run this term — no action needed.

Hi {parentFirstName},

A quick update: the {schoolNickname} {classType} class that {studentFirstName} was waitlisted for won't be running this term, so the waitlist is closed. No payment was ever taken and there's nothing you need to do.

If the class is offered again at {schoolNickname}, registration will open through the school as usual — and if you'd like a heads-up when that happens, just reply to this email and we'll make sure you hear first.

Sorry it didn't work out this time!

Higher Ground Learning

---

## CX-C — Cancellation Notification (school contact)

**Audience:** school contact · **Trigger:** same admin confirm · **From:** info@ · **Footer:** T
**Subject:** {schoolNickname} {classType} has been cancelled
**Preheader:** Families have been notified with their options.

Hi {counselorFirstName},

A heads-up: the {schoolNickname} {classType} class scheduled to start {firstSessionDate} didn't reach the minimum enrollment, so we've had to cancel it.

All registered families have already been notified directly with their options (including a full refund), so there's nothing you need to do — though if any parents mention it, you can let them know to check their email.

Thanks for your help promoting the class. If there's interest in running it again in a future term, we'd love to try — just reply to this email.

Higher Ground Learning
