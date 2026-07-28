# Portal fixes — batch 22 (🚧 OPEN — accumulating, do not start yet)

Opened July 29, empty. Scarlett will say when it's ready to pull; if extended after you've pulled it, wait for an explicit re-read ask.

Next PL after this batch: **PL-209**.

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

*(Still on the radar from prior sessions: the Students-header mixed-units count ("3 students" vs "Current (4)") · duplicate identical weekly slots accepted without warning · anything from the batch-21 verification pass.)*
