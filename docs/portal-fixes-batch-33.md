# Portal fixes — batch 33 (ACCUMULATING — opened Aug 8, 2026)

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped · registry template edits ship as new versions via anchor guards · verify composed blocks via the composer path · inline confirm banners only · NO native browser dialogs.

## PL-323 — Block-ending continue flow v2: choose-your-hours, auto-drop default, and session reservation (Scarlett, Aug 8 — extends PL-299; her copy below goes live ONLY once the flow it describes exists)

**A. The default is auto-drop.** When a prepaid block's hours run out with no confirmation, the student's scheduled sessions DROP OFF the calendar at the exhaustion point — that is the default, not just "no billing". (PL-299 shipped scheduling holds; this extends to: future sessions past the block are actually released/cleared from tutor calendars, so "the sessions simply stop when your prepaid hours are gone" is literally true.)

**B. Continue is a choice, not perpetuity.** The portal "Continue tutoring" button opens a chooser: **5 hours · 10 hours · 15 hours · until I cancel** (5/10/15 = a new hours block at the correct post-class rate for their provenance — PL-322 rates; "until I cancel" = the standard monthly plan). Parents who bought a block shouldn't have to commit to open-ended billing with one click.

**C. Reservation with conflict handling.** After the parent chooses, the portal attempts to reserve the continuing sessions (same tutor only) using the SAME session-picker architecture built for rescheduling — looking far enough ahead to cover the chosen amount. Clear times → reserved, parent sees confirmation. Conflict or the parent can't find times that work → it routes to staff exactly like a reschedule request ("we'll figure it out for you"), and staff get an alert. Parent is alerted of the outcome either way.

**D. Rate correctness.** {tutoringHourlyRate} composes from the family's own engagement (already true); the CONTINUING rate must follow the student's domestic-vs-international provenance via the PL-322 rule, one source with the price list.

**E. Scarlett's copy (exact strings — publish as the new BL_BLOCK_CONFIRM version WHEN A–C exist; formatting as current draft; {studentTutorName} composes the student's tutor):**
Subject: {studentFirstName}'s tutoring hours are almost used up — one quick confirmation
Preheader: {blockHoursLeft} of {blockHours} hours left — confirm to continue
> Hi {parentFirstName},
>
> A quick heads-up: {studentFirstName} has **{blockHoursLeft} left of the {blockHours} tutoring hours** you purchased.
>
> When those hours are used up, tutoring can continue on our standard 1-on-1 plan — same tutor, same schedule — billed monthly at **{tutoringHourlyRate}/hr**.
>
> **Please confirm if you'd like to continue**: open your family portal (no password needed) and use the "Continue tutoring" button (or just reply to this email) and we'll keep the times reserved for {studentFirstName}. If you're not sure what makes the most sense, please respond to this message; we'll get all the info from {studentTutorName} and make an action plan.
>
> [button:Open your family portal]({portalLink})
>
> If we don't hear from you, nothing bills past the hours you purchased — the sessions simply stop when your prepaid hours are gone.
>
> Thanks!
>
> Higher Ground Learning

Until this ships, the current BL_BLOCK_CONFIRM draft/twin copy stays (it is truthful about today's behavior); do not publish copy E early.
