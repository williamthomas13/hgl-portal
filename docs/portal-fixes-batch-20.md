# Portal fixes — batch 20 (🚧 OPEN — accumulating, do not start yet)

Opened July 27, first item from Scarlett's email review. Scarlett will say when it's ready to pull; if it's extended after you've pulled it, wait for an explicit re-read ask.

Next PL after this batch: **PL-180**.

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
