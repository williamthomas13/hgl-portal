# Portal fixes — batch 20 (🚧 OPEN — accumulating, do not start yet)

Opened July 27, first item from Scarlett's email review. Scarlett will say when it's ready to pull; if it's extended after you've pulled it, wait for an explicit re-read ask.

Next PL after this batch: **PL-183**.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

## PL-178 (small) · CX_WAITLIST gets the 1-on-1 tutoring offer its WR sibling has

Two sibling waitlist-closure emails, one gap. **WR_WAITLIST_RELEASE** (class ran, stayed full) carries the deliberate 1-on-1 offer — "we can help right away with **1-on-1 tutoring**… [Share your availability]({availabilityLink})" — per Scarlett's PL-59 rationale: someone who wanted SAT prep and was willing to pay should be helped asap. **CX_WAITLIST** (class cancelled, waitlist closed) is closure-only. The Jul 22 case analysis accepted that, but Scarlett's Jul 27 review overturns it (her words): "this person was on the waitlist and wants our services, and we have the capabilities to meet their needs outside of this group class that was cancelled." The family's situation is identical regardless of WHY the seat never materialized — if anything the cancelled case is stronger, since no future section of that class exists to wait for.

- **Build CX_WAITLIST's new body FROM WR's approved copy, not by patching the old one** (Scarlett, Jul 27: the waitlisted parent's experience is the same no matter why their student can't take the class — so it should essentially be the same email). Take WR_WAITLIST_RELEASE's body verbatim and change ONLY the why-sentence: "the class stayed full, and we weren't able to open up a place for {studentFirstName}" → the cancellation equivalent ("the {className} class won't be running this term"). Offer paragraph, `{availabilityLink}` machinery, no-payment line, still-on-our-list close, `{contactBlock}` — all identical to WR. No pricing in the email (that lives in the scheduling conversation, per PL-59). This means the substance is ALREADY approved copy; only the swapped sentence is new for Scarlett's review.
- **Reseed as a new version** (never overwrite; Scarlett reviews via test-send before any flip if the template is draft, or the new version goes live on save if it's already live — follow the template's current state).
- **Subject/preheader: match WR's shape** — "An update on the {className} waitlist — and an option for {studentFirstName}", preheader in WR's voice ("We couldn't run the class — but we can still help right away."); Scarlett approves the final wording.
- **Sample data (PL-56/82 discipline):** the sample must show the availability link resolving, not a bare token.

**Verify:** diff CX-W's new body against WR shows ONLY the why-sentence differing (plus subject/preheader) · render shows the offer with a working tokenized link · no pricing anywhere · test-send to billy@ for Scarlett's review.

## PL-179 (small) · Covered sessions announce themselves on the substitute's upcoming list

Verified state (source, Jul 27): the hand-over note IS saved — `coverage_requests.handoff_note` — and the substitute's portal has a dedicated handoff section: session, location, the note (with sender's first name), and the student's last 8 session notes (PL-111/156). The machinery is right. The surfacing has a gap: an accepted coverage session ALSO lands on the substitute's regular upcoming-sessions list looking exactly like their own sessions, with none of that context attached to the row.

Scarlett's rationale (Jul 27): an instructor knows how to get ready for their own students on autopilot — someone else's student is exactly where autopilot fails, so the covering context must find them, not wait to be found.

- **Badge the row:** a covered session in the upcoming list carries a visible "Covering for {requesting tutor first name}" marker — same visual weight as the PL-132 "Class" badge, one glance.
- **Context one tap away (or inline):** the row links straight to that session's handoff bundle — hand-over note + the student's note history. If the note is short, consider rendering it inline/expandable on the row itself; the tap should never be required to discover the note EXISTS.
- **The badge is state-driven** (from `coverage_requests` accepted + candidate = me), not a sent-email artifact, per the standing rule.
- Applies wherever the substitute sees the session: upcoming list, and the PL-160 calendar view when it lands (a covered block should carry the same marker).

**Verify:** accepted coverage → row shows "Covering for {name}" with handoff link · handoff note reachable in one tap from the row · own sessions unaffected · marker clears if coverage is withdrawn/reassigned · PL-160 (when built) renders the marker on the calendar block.

## PL-180 · Calendar edits flow BACK to the portal — two-way sync with a human gate

Scarlett moved a tutoring session directly in the billy@ Google Calendar and the portal never noticed (Jul 27). She's right that this can't be prevented — tutors live in their calendars, and an event that LOOKS draggable will get dragged. Today the sync is one-way (portal → calendar, with portal-side edits patching drifted events), so a calendar-side edit silently forks reality: the tutor's calendar says one time, the portal — and everything it drives — says another.

Why not silent two-way: a session time is not just a calendar fact. It drives parent schedule notices (T3), billing lines, timecards, and attendance. Silently adopting a calendar drag would let one gesture in Google bypass the notice/urgency machinery (PL-81), the late-reschedule fee logic, and the family's approved schedule. So: **detect always, adopt deliberately.**

- **Detect:** extend the existing drift machinery (the XCL- audit pattern, already comparing portal sessions to calendar events) to tutoring session events — compare on the sweep AND on tutoring-page load, so detection isn't a day behind.
- **Surface — and say WHO, not just WHAT (Scarlett, Jul 28):** the alert is attributional, not neutral. The portal knows what it last wrote to the event, so a differing calendar state means someone edited it calendar-side — on the tutor's own calendar, that's the tutor. Copy shape: "**Billy moved Ana's Tuesday session in his Google Calendar — 4:00 → 5:00.** The family hasn't been told and billing hasn't changed. Adopt (runs the normal reschedule) or revert his calendar." A neutral "mismatch" framing hides the two facts that drive the decision: a person made a change, and none of the machinery has run. Needs-attention row + a marker on the session row; deep-link per the standing rule.
- **Resolve, one click each way:** **Adopt** runs the NORMAL reschedule machinery with the calendar's time (parent notice, fee logic, timecard implications — everything a portal-side reschedule would do), so adopting is never a back door. **Revert** patches the calendar event back to the portal's time (which the sync already knows how to do).
- **Optional accelerator, Scarlett's call at review:** if the same tutor's calendar edits are adopted routinely, a per-tutor "auto-adopt with notice" setting later — start gated, earn the automation.

**Verify:** calendar-side time drag → detected on next sweep AND on page load · adopt fires the reschedule path (T3/urgency/fee logic all engage, verified against a <24h session) · revert restores the calendar event · portal-side edits still patch outward untouched · no detection loop (adopt/revert converge, don't re-flag).

## PL-181 (small) · Test scores live everywhere the student does: profile, class roster, and 1-on-1

Scores exist (the milestone machinery, counselor-view display), but entry/viewing doesn't follow the student. Classes ALWAYS include two diagnostics, and instructors read those results as a group; 1-on-1 students often have diagnostics too.

- **One score store, three surfaces:** (1) the student profile — view + enter, full history; (2) the class page/roster — view + enter for that class's students as a group (the instructor's two-diagnostics workflow: enter a column of scores in one sitting, see the group side by side); (3) the tutoring page — the existing milestone entry stays, backed by the same store.
- Class surface supports the group read: per-diagnostic columns (Diag 1 / Diag 2), students as rows — the "is this group moving" glance the instructors actually do.
- Same score visible from every surface the moment it's entered on any of them (one table, no syncing).
- Role visibility follows existing rules (counselor sees what counselor-view already grants; parents unchanged).

**Verify:** score entered on the class roster appears on the student profile and tutoring view instantly · group grid renders both diagnostics · history preserved · role-gated correctly.

## PL-182 (small) · One prospective-student form: quick add and full add merge

The quick add "on a phone call" flow and the full add-prospective-student form are nearly the same thing with an arbitrary wall between them. Remove the wall (Scarlett, Jul 27):

- **Remove the separate "on a phone call" quick add.**
- **One add-prospective-student form where everything except the bare minimum is optional** (minimum: enough to identify them — name; whatever contact info exists). Kelsie enters whatever she has at the time; the rest arrives via the intake sheet anyway, which is where completeness is actually enforced.
- The form should make partial entry feel normal, not like an error state — no required-field noise on fields the intake sheet will fill.
- **Completeness still gates the right things downstream:** whatever currently requires full info before a student starts (intake complete markers, scheduling) keeps requiring it — this changes where data ENTERS, not what's required to proceed.

**Verify:** add with name only → saves, appears in pipeline · intake sheet later fills the gaps onto the same record (no duplicate) · downstream gates still hold · the old quick-add path is gone and nothing references it.
