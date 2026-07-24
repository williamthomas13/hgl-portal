# Portal fixes — batch 17 (family-facing UX, from the July 23 walkthrough)

Seven items, PL-124…130. Scarlett greenlit all off the stakeholder walkthrough — registration-page polish (PL-124…126) plus two cancellation-flow items (PL-127…128). Public-facing, pre-launch. Continues PL-x numbering.

**Note:** the earlier "add-on doesn't appear" finding was a false alarm — the add-on step exists and works per spec §9 (`register/[id]/page.tsx:98,173-185`); it renders after the form, which the walkthrough hadn't reached. Nothing to fix there.

**Standing rules:** plain-English copy · no internal shorthand · realistic samples · "in the days before class starts" (never a hard day count — global copy rule) · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

## PL-124 (tiny) · Registration page sets the "what happens next" expectation ✅

> **Shipped, browser-verified on BOTH surfaces.** Registration page: one calm sentence directly under the Proceed-to-payment button (hidden in the waitlist state, where payment isn't next) — "After payment you'll get a confirmation email right away, and class details arrive in the days before the first session." Success page: a matching line under the confirmation paragraph ending "— nothing else to do right now." Standing copy rule respected: "in the days before the first session", no day count anywhere (asserted in the DOM).

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

## PL-126 (tiny) · Timezone label on the session calendar ✅

> **Shipped, verified across two zones with zero hardcoding.** New `timezoneCityLabel()` in `dates.ts` (leaf — shared with PL-118's `zonedDeadline`, one source for the city-name rendering) and an optional `timezone` prop on the shared `SessionCalendar` component: "(times shown in {city} time)". Wired on the registration page, the course-calendar page, and the parent portal's class card; `/api/class-info` now carries `schools.timezone` so the public pages derive it from the IANA record. Verified live: the Mexico City school's register page reads "(times shown in Mexico City time)" and a QA school pinned to Europe/Rome reads "(times shown in Rome time)" on the calendar page (fixture cleaned). The subscribe links are untouched — this is for families reading the page.

Sessions render in school-local time (correct), but an international parent has to guess the zone. Add a one-line label on the session list — "(times shown in {schoolCity}/{school timezone} time)" — derived from the school's IANA timezone record, not hardcoded. The calendar-subscribe link already handles zone conversion for those who use it; this is for the ones reading the page.

**Verify:** label renders with the correct school timezone for classes in different school zones (e.g. a Mexico City school vs a Rome school); no hardcoded zone.

## PL-127 (tiny) · Set the next expectation after availability is shared

After a family self-serve converts and shares availability (the `/convert/{id}` → availability page confirmation state, and the standalone `/availability/{token}` "Saved" state), the page currently ends the family's visibility with no sense of what's next. Add one calm line to the saved/confirmation state: "We'll review your availability and propose specific times within {N} business days — watch your inbox." **By role/team, not a person's name** (PL-112 rule — never "Kelsie"). Pick a realistic N with Scarlett (2–3 business days is typical); keep it one sentence.

**The same clock on the ops side (Scarlett's requirement):** the promise made to the family must be visible internally so ops holds itself to it. The Needs Attention "availability shared but not scheduled" row (and the AL_AVAILABILITY_SHARED alert if it re-renders) carries the deadline derived from the SAME N — "shared {date} · propose times by {date}" — and the row escalates visually (overdue styling / moves up) once the promised date passes. Derive both surfaces from one shared constant so the family-facing line and the ops countdown can never disagree (the PL-96 lesson applied to copy: one source of truth).

**Verify:** the line renders on both the post-conversion availability confirmation and the standalone availability "Saved" state; no hard-coded staff name; the Needs Attention row shows the promise date computed from the same constant and flips to overdue styling when it passes; E2E: share availability → row shows the deadline → backdate the share → row reads overdue.

## PL-128 · Refund path: real state, small footprint, retention-aware copy

Today the CX cancellation email's refund option is "just reply." Give it a genuine state without upstaging the conversion:
- **Refund becomes a stamped self-serve request** — a tokenized link (house HMAC pattern, like convert) that records a refund request with a state (so it can't be lost in an inbox and shows on the admin/family record), rather than relying on an email reply.
- **Presentation: small text hyperlink, NOT a button.** The "Convert to 1-on-1 tutoring" stays the big blue button — the visual hierarchy should steer toward retention. The refund link sits quietly below (e.g. "Prefer a refund? Request one here.").
- **Copy revisions (Scarlett):** the family should NOT have to "let us know" / justify to get the refund — the stamped request is enough. BUT add a line that if they're unsure, they should reach out to talk it through (a human off-ramp before refunding). AND add the retention fact: **1-on-1 tutoring hours are transferable and never expire** — surface this near the convert option and again by the refund link, because "never expires / transferable" is exactly the reassurance that turns a refund into a conversion. (Confirm the transferable/never-expire claim is operationally true before it ships in copy.)
- Admin side: a refund request should surface as a state-driven Needs Attention row (PL-100) with the family/enrollment deep-link, so Ops sees it and issues the actual refund in Stripe (refunds stay Option A — dashboard-issued, portal moves no money; the request is a tracked intent, not an automatic refund).

**Verify:** CX email renders the big convert button + small refund text link + the transferable/never-expire line + the "unsure? talk to us" off-ramp; refund link stamps a tracked request (no money moves); request appears as a Needs Attention row deep-linking the record; convert flow unchanged.

## PL-129 (small) · Leads page: always-visible mid-call "quick add"

The phone-intake reality: Ops types the parent's name while talking, and the current "Add a prospective student" is an expandable form with many fields — mid-call friction is where leads get lost. Add a compact, **always-visible** quick-add at the top of the leads page: parent name + phone (email optional), one "Add" button, done in two fields. The row lands in the pipeline as a new lead immediately (source = phone call), and everything else — student name, school, what-they-want — gets filled in on the lead record after the call (the record's edit surface already exists). Keep the full expandable form for the deliberate-entry case; quick-add is the fast path, not a replacement. The new lead should be focused/highlighted after add (the `useDeepLinkFocus` machinery) so the follow-up details go straight in.

**Verify:** quick-add visible without expanding anything · two-field submit creates a pipeline lead (source recorded) and focuses it · full form unchanged · pipeline nudge ("no touch in 4+ days") applies to quick-added leads.

## PL-130 · Family portal: upcoming tutoring sessions card + "request a change"

The family portal shows enrollments and (since PL-111) session notes, but no upcoming-session list for tutoring — the tutor has one; the family needs it more. Add one card to the family portal's tutoring section:
- **Next sessions** with dates/times in the family's timezone (fall back to the engagement/tutor zone with a label if none stored), tutor first name, location/meet link where set. Same data the tutor view renders, family-scoped through RLS (parents see only their own student's sessions — verify the policy, don't assume).
- **"Request a change" on each session** — the family-side sibling of the tutor's substitute-request flow (PL-112 pattern): picks the session, proposes an alternative window or "can't make it" + free text, stamps a tracked request (state-driven — no email archaeology), fires an Ops alert with deep links, and lands as a Needs Attention row ("change requested for {student}'s {date} session") that clears when the session is rescheduled/cancelled through the existing office-mediated machinery. This does NOT self-serve reschedule — the office still makes the change (T3/T3-T confirm as today); it converts the most common inbound email into pipeline.
- Late-change policy surface: if the request lands inside the late-cancel window, say so honestly on the form before submit ("this is within {X} of the session — the late-change policy may apply") rather than surprising the family later.
- **T1 "request changes" routes here too (Scarlett):** the monthly proposal email's "request changes" path points at this same tracked-request form (tokenized, house pattern) instead of reply-by-email — same state, same Ops alert, same Needs Attention row. Deliberate side effect: change requests become countable, so the future availability-grid self-serve upgrade is a data-driven call. Keep "or just reply" as a soft fallback in the email copy — never wall off the human path.
- **"Your month at a glance" (Scarlett):** the card also carries a compact month summary mirroring T1 — this month's session count, month total, and for package-funded families the **package hours remaining** (from the same decrement machinery that bills them — one source of truth, never a parallel count). Hours-remaining visibility preempts the "how many hours do we have left?" email and doubles as the runway signal the audit flagged (the <2-sessions-left moment). **Decrement transparency:** any non-session decrement is labeled at the ledger line ("1 hour — late cancellation, {date}") — the policy itself lives in the signed agreement and the just-in-time form line; no standing policy reminder anywhere else (Scarlett's call).

**Verify:** card renders for a family with upcoming sessions (times in the right zone) and hides cleanly with none · RLS: another family's sessions unreachable · change request stamps state + alert + Needs Attention row, clears on resolution · late-window honesty line renders when applicable · office-mediated reschedule path unchanged · T1's request-changes link lands on the tracked form (reply fallback kept in copy) · month-at-a-glance totals and package hours-remaining match the billing machinery exactly (E2E against a package family fixture).

**Batch-wide verify:** full gate battery green; single-student registration + checkout path unchanged; add-on step still works alongside the sibling path; CX convert flow unchanged by the refund additions.
