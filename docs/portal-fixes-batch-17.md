# Portal fixes — batch 17 (family-facing UX, from the July 23 walkthrough)

Five items, PL-124…128. Scarlett greenlit all off the stakeholder walkthrough — registration-page polish (PL-124…126) plus two cancellation-flow items (PL-127…128). Public-facing, pre-launch. Continues PL-x numbering.

**Note:** the earlier "add-on doesn't appear" finding was a false alarm — the add-on step exists and works per spec §9 (`register/[id]/page.tsx:98,173-185`); it renders after the form, which the walkthrough hadn't reached. Nothing to fix there.

**Standing rules:** plain-English copy · no internal shorthand · realistic samples · "in the days before class starts" (never a hard day count — global copy rule) · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

## PL-124 (tiny) · Registration page sets the "what happens next" expectation

The page shows the class, sessions, and "$899 per student" but nothing about what follows payment, so a family that just paid has no confirmation of what to expect and emails to ask. Add a short, calm line — near the Proceed-to-payment button and/or on the success page — e.g. "After payment you'll get a confirmation email right away, and class details arrive in the days before the first session." Use the global "in the days before class starts" phrasing, not a specific day count. Keep it one sentence; this is reassurance, not a wall of text.

**Verify:** line renders on the registration page (and/or success page) for a class; wording matches the standing copy rule.

## PL-125 · Sibling registration — "register another student" without re-entering the parent

Siblings are a frequent real scenario (Scarlett). Today two children = two full passes including re-typing the parent/guardian block. Add a path that keeps the parent/guardian info and lets the family add another student to the same checkout or an easy repeat.

Design guidance (Code's call on the cleanest implementation):
- After the student block, an "**+ Add another student**" control that reveals a second (third…) student block reusing the already-entered parent/guardian info.
- Each student is its own enrollment against the same class, tied to the same family (the `upsertFamilyAndStudent` path in `app/utils/registration.ts` already keys the family by parent email and dedupes — so N students under one parent email is the natural shape; verify the sibling siblings don't collide on the student dedupe key when names differ, and DO collide correctly if the same student is entered twice).
- Checkout: prefer **one Stripe checkout session with a line item per student** (+ any per-student add-on) so the family pays once — mirror the existing single-enrollment add-on line-item mechanics (`/api/register` → `proceedToCheckout`). The paid webhook must fan out to create/confirm each student's enrollment (extend `checkout-paid.ts` to handle multiple enrollment ids in metadata — today it's one `enrollmentId`). If multi-enrollment metadata is too big a lift for launch, fall back to a "register another student" that re-renders the form with the parent block pre-filled and runs a normal second checkout — still saves the re-typing, at the cost of two payments. Flag which path you took.
- #0 confirmation: each student still gets their own #0-S; the parent gets one #0-P per enrollment OR a combined recap — decide and note it (per-enrollment is simplest and consistent with today).
- Capacity/waitlist: check remaining capacity against the number of siblings being registered (2 siblings into 1 remaining seat must not both land Paid) — this is the important correctness edge.

**Verify:** E2E with QA data (data is wiped pre-launch, so real test registrations are fine): register two siblings under one parent → one payment if the combined path shipped → two enrollments, two students, one family, each student's #0-S sent, parent recap correct; the 2-into-1-seat capacity case handled (waitlist or block, never oversell); single-student registration unchanged.

## PL-126 (tiny) · Timezone label on the session calendar

Sessions render in school-local time (correct), but an international parent has to guess the zone. Add a one-line label on the session list — "(times shown in {schoolCity}/{school timezone} time)" — derived from the school's IANA timezone record, not hardcoded. The calendar-subscribe link already handles zone conversion for those who use it; this is for the ones reading the page.

**Verify:** label renders with the correct school timezone for classes in different school zones (e.g. a Mexico City school vs a Rome school); no hardcoded zone.

## PL-127 (tiny) · Set the next expectation after availability is shared

After a family self-serve converts and shares availability (the `/convert/{id}` → availability page confirmation state, and the standalone `/availability/{token}` "Saved" state), the page currently ends the family's visibility with no sense of what's next. Add one calm line to the saved/confirmation state: "We'll review your availability and propose specific times within {N} business days — watch your inbox." **By role/team, not a person's name** (PL-112 rule — never "Kelsie"). Pick a realistic N with Scarlett (2–3 business days is typical); keep it one sentence.

**Verify:** the line renders on both the post-conversion availability confirmation and the standalone availability "Saved" state; no hard-coded staff name.

## PL-128 · Refund path: real state, small footprint, retention-aware copy

Today the CX cancellation email's refund option is "just reply." Give it a genuine state without upstaging the conversion:
- **Refund becomes a stamped self-serve request** — a tokenized link (house HMAC pattern, like convert) that records a refund request with a state (so it can't be lost in an inbox and shows on the admin/family record), rather than relying on an email reply.
- **Presentation: small text hyperlink, NOT a button.** The "Convert to 1-on-1 tutoring" stays the big blue button — the visual hierarchy should steer toward retention. The refund link sits quietly below (e.g. "Prefer a refund? Request one here.").
- **Copy revisions (Scarlett):** the family should NOT have to "let us know" / justify to get the refund — the stamped request is enough. BUT add a line that if they're unsure, they should reach out to talk it through (a human off-ramp before refunding). AND add the retention fact: **1-on-1 tutoring hours are transferable and never expire** — surface this near the convert option and again by the refund link, because "never expires / transferable" is exactly the reassurance that turns a refund into a conversion. (Confirm the transferable/never-expire claim is operationally true before it ships in copy.)
- Admin side: a refund request should surface as a state-driven Needs Attention row (PL-100) with the family/enrollment deep-link, so Ops sees it and issues the actual refund in Stripe (refunds stay Option A — dashboard-issued, portal moves no money; the request is a tracked intent, not an automatic refund).

**Verify:** CX email renders the big convert button + small refund text link + the transferable/never-expire line + the "unsure? talk to us" off-ramp; refund link stamps a tracked request (no money moves); request appears as a Needs Attention row deep-linking the record; convert flow unchanged.

**Batch-wide verify:** full gate battery green; single-student registration + checkout path unchanged; add-on step still works alongside the sibling path; CX convert flow unchanged by the refund additions.
