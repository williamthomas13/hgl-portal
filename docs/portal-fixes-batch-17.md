# Portal fixes — batch 17 (registration-page UX, from the July 23 walkthrough)

Three items, PL-124…126. Scarlett greenlit all three off the stakeholder walkthrough (§1, parent-signup journey). Small, public-facing, pre-launch polish on the highest-traffic page. Continues PL-x numbering.

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

**Batch-wide verify:** full gate battery green; single-student registration + checkout path unchanged; add-on step still works alongside the sibling path.
