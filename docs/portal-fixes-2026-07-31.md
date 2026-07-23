# Portal fixes — batch 13 (July 2026, follows batch 12)

Eleven items; PL-87 first (pre-launch guard gap). Continues PL-x numbering.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

---

## PL-87 (pre-launch guard gap) · Real sends must never carry a non-production origin ✅

> **Shipped, E2E 13/13.** **(a)** `sendOnce` scans every real (non-test) send's HTML for absolute URLs whose host is non-production — localhost / 127.x and private IPv4 ranges / `[::1]` / `*.ngrok*` / `*.local` / **any `*.vercel.app` other than the pinned production host** (preview deployments count) — and refuses with an admin alert; verified refused for all four classes **with ALLOW_REAL_EMAILS=1 set**. The alert quotes offending hosts scheme-less so it can never trip its own guard; test-sends stay exempt (verified). External links (College Board etc.) pass untouched. **(b)** New `app/utils/base-url.ts`: `PRODUCTION_ORIGIN` (pinned `https://hgl-portal.vercel.app`, overridable via `PRODUCTION_BASE_URL`) + `emailBaseUrl()`, now the compose base for **all 22 email/collateral URL-build sites** (lifecycle's 11 signed-link builders, instructor/counselor/tutoring/agreement/timecard/login-link/lead/notify-interest composes, alert admin links, collateral PDFs) — a dev machine now composes production links before the guard ever runs; verified `emailBaseUrl() === PRODUCTION_ORIGIN` under a dev-shaped env. Browser-flow origins (Stripe checkout redirects, claim/resume redirects, QBO OAuth callback, portal UI copy-links) deliberately stay on the env origin. **(c)** Sweep of all 99 real sent rows: 37 re-renderable, all clean; 62 composed-at-send with no stored HTML — of those, every CX_TUTORING_START row's enrollment is deleted (QA-PL76 cleanup), so **zero rows have a live re-send target and nothing needs re-sending**. **(d)** The dev-shaped-environment refusal E2E is the 13-check script above (alert-fired assertion included).

**Sighting (Scarlett):** the real CX_TUTORING_START send from the PL-76 live verification ("Let's get QA-PL76-Student's 1-on-1 tutoring going") carries a `localhost:3000` availability link → ERR_CONNECTION_REFUSED for the recipient. Root cause is the PL-60 pattern one level up: the verification ran from a dev machine with the real-email override on, and the compose picked up the dev origin. The PL-60 dead-href tripwire didn't fire — the href isn't empty, just wrong.

- **(a) Origin guard at send time.** `sendOnce` (real sends only — not test-sends) scans the outgoing HTML for non-production origins (`localhost`, `127.0.0.1`, `*.ngrok*`, any origin ≠ the configured production base URL). On match: refuse the send loudly + admin alert. The ALLOW_REAL_EMAILS override must NOT bypass this — a deliberate dev-machine real send still may never ship a dev link.
- **(b) Pin the base URL for real sends.** When composing a real (non-test) email, the base URL comes from a pinned production setting (env/app_settings), never from the request origin or dev env — so even before the guard, dev-machine real sends compose correct links.
- **(c) Sweep + repair.** Audit whatever rendered-HTML records exist for real (non-test) sends containing non-production origins; list them. Expected blast radius: QA/billy recipients only (no real families exist pre-Aug 20) — re-send corrected copies where the QA flow matters (the QA-PL76 CX-T at minimum), and note any that don't.
- **(d) Regression:** an E2E that attempts a real send from a dev-shaped environment and asserts it's refused with the alert fired.

## PL-85 · T3-T deltas collapse to the net effect per session ✅

> **Shipped, E2E 13/13 (+ the PL-81 suite re-run green, 26/26).** `collapseChanges()` in tutor-notices.ts builds per-session chains — a reschedule's recorded change now carries its `replacementId`, so a later change to the replacement session chains onto the original (that's the mechanism that makes "per session" true across moves, since each move mints a new session row). One line per chain: original state as of the window's first change → final state. Verified: move+cancel → one cancelled line at the ORIGINAL time · move chain Mon→Tue→Thu → one "moved to Thu" line · **round trip → no line, and an all-round-trip batch sends NO email** (the pending row is marked cancelled so the audit trail says why; delivery-path verified through the real sweep) · a no-show on another session stays its own line. The subject counts COLLAPSED lines (3 raw changes on one session + 1 no-show → "2 schedule changes"). The PL-81 E2E was extended per the doc and its coalescing checks re-fixtured onto distinct sessions (same-session multi-deltas are exactly what now collapses).

Follow-on to PL-81, from Scarlett reading the E2E's coalesced notice (three same-timestamped fixture sessions each exercising one delta type — confusing to read, and the same confusion would hit real sends whenever ONE session changes more than once inside a coalescing window).

- **Collapse deltas per session id** across the window: the "What changed" list shows each session once, as original state → final state. "Moved Mon→Tue, then cancelled" renders one line: "…session on **Mon, Jul 27, 5:41 PM** was cancelled." A move chain (Mon→Tue→Thu) renders "…moved to **Thu, Jul 30, 5:41 PM**."
- **A round trip disappears:** a session moved away and back to its original time within the window produces no delta line (and if that empties the batch, no email sends).
- The original-state label is the state as of the window's first change (what the tutor last knew), never an intermediate.
- Attendance marks (no-show) keep their own line; they don't merge with time changes on other sessions.
- Extend the PL-81 E2E: chained move+cancel → one line; round-trip → no email.

## PL-86 · Self-serve cancellation→tutoring conversion (button → confirm → availability, one flow)

Approved by Scarlett. The reply path stays (families who want to talk get Kelsie), but families who'd rather click get a straight-through flow:

- **CX_FAMILY's tutoring option gains a tokenized link** (family-scoped HMAC, same pattern as everything else) to a conversion page stating the persisted PL-84 terms plainly: "Convert my {className} payment to **{offerHours} hours** of 1-on-1 tutoring."
- **Scanner-safe confirm:** the conversion fires only on a JS-executed POST behind one visible tap — a mail prefetcher can never convert a family. Idempotent: revisits show the friendly already-done state.
- **On confirm:** mint the hours package exactly as the admin one-click does (PL-84 machinery, `cancellation_conversion` source), alert the Ops Director, and — without leaving the page — **the same page becomes the availability grid** (the existing `/availability/[token]` component inline). Confirm → share availability, one continuous flow, no interstitial email.
- **CX_TUTORING_START demotes to a follow-up** in the self-serve path: it sends only if the family confirmed but didn't share availability (suggest +1d), and still sends immediately when Kelsie converts manually from a reply (there it remains the receipt of the conversation). Never both.
- Admin: the enrollment shows who converted (family self-serve vs Ops Director) — mirrors the PL-83 automatic/by-hand distinction.
- **Path reconciliation (explicit, not incidental):** we never know which path a family will take, so first-action-wins with graceful seconds. Conversion is idempotent **per enrollment** across both paths — if the family already self-served, Kelsie's admin button renders "already converted — self-serve, {date}" (no-op); if Kelsie already converted, the family's tokenized page skips straight to the already-done state + availability grid. CX_TUTORING_START's dedupe keys on the enrollment so it sends exactly once ever (receipt OR +1d nudge, whichever fires first). The self-serve Ops alert + the conversion marker mean Kelsie always sees the current state before acting on a reply.
- CX_FAMILY's {cancellationOptionsBlock} copy gets the link on its tutoring option; wording final unless Scarlett edits in the editor.

## PL-88 (tiny) · IN_WELCOME's {classSummaryLine} includes the school ✅

> **Shipped, render-verified.** The composed line in instructor-comms now reads "…starts {date}, **in person at {schoolNickname} ({schoolFullName})**" (online: "…, online — {nickname} ({full name})"). All three IN_ per-template sample pins updated to "…in person at SIS (Sample International School)" — the existing sample school name kept, consistent everywhere. Verified against the live registry: IN_WELCOME's active version is **v5 (Scarlett's — untouched)** and its preview renders the school-named line via the samples; the code twin composes identically from the bundle.

Scarlett: "SIS SAT Prep — starts Saturday, September 5, 2026, in person" should name the school — "…in person **at SIS (Stockholm International School)**." The line is a composed variable, so it's a compose change, not template copy:

- In-person → "…starts {date}, in person at {schoolNickname} ({schoolFullName})". Online → same idea with sensible wording, e.g. "…starts {date}, online — {schoolNickname} ({schoolFullName})".
- Update the sample to match. Sample school name: Scarlett has no preference ("Sample International School" stays fine) — just keep whatever's used consistent everywhere.
- Editor context: IN_WELCOME is at **v5** (subject + matching body opener "here are the details", tightened calendar + class-page paragraphs) — don't reseed over it; this item only changes the composed variable.

## PL-89 (tiny) · Class-details warnings anchor to #4's send date; the HOLD stops sounding routine

Scarlett, reading AL_CLASS_DETAILS_HOLD: "if we don't have the location at this point, it's not going to be solvable in an hour. This notification should go out three days in advance." Context: #4 sends at first-session −4d; the existing AL_MISSING_DETAILS daily nag starts at first-session −6d — only 2 days of warning, and it's framed around the class start, not the email deadline.

- **AL_MISSING_DETAILS re-anchors:** starts **3 days before #4's scheduled send** (derive from the SEQUENCE offset — first-session −7d today — never hardcode), daily until resolved or the class starts. **Approved body (build out from today's bare three sentences; blank-field bullets render conditionally):**

> **{schoolNickname} {classType}** — first session **{firstSessionDate}** (in {x} weeks).
>
> The "class details" email to families goes out **{fourSendDate}** (in {n} days), and it can't send while these are blank:
>
> - **Location** — blank. Classroom request status: asked the counselor {CR1 date} · nudged {CR2 date} · last call {CR3 date or "not yet sent"}.
> - **Instructor** — blank. Assign one on the class page.
>
> [button: Fill in class details] → class admin
>
> If the room comes through, filling it in releases everything automatically — nothing else to do. If it's still blank when the email is due, the send holds and families wait; that's the next alert you'd get.
- **AL_CLASS_DETAILS_HOLD copy update** (it now only fires after the 3-day warning failed): "The class-details email was due this morning and is being held — families are waiting on it. Fill in {gaps} on the admin page and it releases on the next hourly sweep." Drop the current breezy framing.
- Both are code-composed alert bodies with registered drafts: update code twins, reseed the drafts, update per-template samples (PL-82 standard — the HOLD sample should show the location-blank case).

## PL-90 (tiny) · AL_DUNNING_EXHAUSTED copy: one charge retried, and "pay-by-link" ≠ resolved ✅

> **Shipped, render-verified 6/6.** Code twin rewritten to the approved direction: "Autopay for **{parent}'s {month} tutoring invoice ({amount})** failed on the **3rd and final attempt** — one charge, retried automatically three times… the family has already been emailed their invoice link to pay by card manually; that was the last automatic step, and **nothing will retry from here**. If it stays unpaid, it's a personal follow-up: [the invoice] · [{parent}'s family record]." Subject reseeded (v2, guard-checked): "Autopay failed after 3 attempts — {month} tutoring invoice past due"; preheader now says automation is out of moves. The two links are the first application of the PL-92 standing rule: `/admin/tutoring?invoice={id}` and `?family={id}` deep-link focus params (new `useDeepLinkFocus` — opens the right section, scrolls to and highlights the exact record). Sample updated to the new shape; old "pay-by-link fallback" framing verified gone.

Scarlett's read of the current body: "All 3 automatic charges failed" mis-describes the mechanics (one charge for one invoice, automatically retried 3 times), and "The family got a pay-by-link fallback" reads like the problem was solved when the alert actually means automation is out of moves. Replace the composed body (code twin + reseed draft + PL-82 sample) with the approved direction:

> Autopay for **{parentName}'s {month} tutoring invoice ({amount})** failed on the **3rd and final attempt** — one charge, retried automatically three times. The family has already been emailed their invoice link to pay by card manually; that was the last automatic step, and **nothing will retry from here**. If it stays unpaid, it's a personal follow-up: [invoice] · [family record]

- Subject: "Autopay failed 3×" → "Autopay failed after 3 attempts — {month} tutoring invoice past due" (same mechanics fix, subject-sized).
- Wording final unless Scarlett edits in the editor after reseed.

## PL-91 · AL_MIN_ENROLLMENT becomes a decision brief (timing, both clocks, and the three moves)

Scarlett: this is a decision point — give the decider everything. Approved design:

- **Fires 3 days before the registration deadline** when paid < minimum (re-derive, never hardcode), noting the counselor's final-days push status ("FP last-call sent {date}"). If the deadline passes still under minimum with no decision, ONE follow-up: "deadline passed — decision needed." No other repeats.
- **Body leads with the full picture:** "{n} paid / {min} minimum / {cap} cap · registration closes in {d} days ({date}) · first session in {x} weeks ({date})."
- **The three moves, spelled out with links:**
  - *Hold* — final-days signups often close the gap (the FP push is already working the counselor side).
  - *Extend the deadline* (commonly a week) — deep-link to the class admin. **Extending must propagate automatically everywhere:** collateral (PL-15 already keys off enrollment_deadline — verify end-to-end), public registration page, FP/counselor comms timing recalcs, and this checkpoint re-arms against the new deadline (fires again at new-deadline −3d if still under min).
  - *Run under minimum or cancel* — running under is a legitimate call ("once in a while we run a class that doesn't hit minimum" — Scarlett), so frame it as a real option, not a failure; cancel links the existing cancel flow.
- Nothing is automatic — the alert informs; the Ops Director decides. Code twin + reseed draft + PL-82 sample (sample should show the 3-days-out case with FP-sent status).

## PL-92 (small) · Overdue-invoice alerts gain action prompts (10-day and 30-day both)

Scarlett on AL_OVERDUE_10's bare body: "How about some action prompt here? Like click here to see Alex's recent profile activity and/or send a manual alert?" Approved build-out for BOTH overdue alerts:

**AL_OVERDUE_10:**

> **{parentName} — {month} tutoring invoice: {amount}**, due **{dueDate}** ({n} days past due).
>
> Already handled automatically: invoice sent {date} · reminder sent {date} — {delivered/opened status from email_sends}.
>
> [button: See {parentFirstName}'s recent activity] → the family record (PL-83 comms timeline, autopay state, credit)
> [link: Re-send the invoice reminder now] → admin-authed one-click on the family page (NOT act-from-email), logged as sent-by-hand on the timeline
>
> Nothing else happens automatically until the **30-day mark**, which adds the late-fee flag — that alert is where you decide.

**AL_OVERDUE_30** leads with the decision ("The late-fee flag is now on the table — waive it, apply it, or make it a phone call") and carries the same status recap plus a full action row (Scarlett: "these emails are a place to take action and not just add a checkbox on a to do list"):

> [button: Apply the 10% late fee] → deep-link to THIS invoice's one-click on the tutoring panel (never the panel root)
> [button: See {parentFirstName}'s recent activity] → family record + timeline
> [link: Send a manual email] → compose panel pre-addressed to the family

Code twins + reseed drafts + PL-82 samples (10-day sample shows delivered-and-opened; 30-day shows delivered-not-opened, since that's the realistic escalation texture).

**Standing rule (apply across the whole AL family while in there):** every internal alert deep-links the *specific record it's about* and carries the one-click actions for its own decision — waitlist rollover links the class's waitlist, webhook mismatch links the payment, etc. Email buttons always land on admin-authed one-click actions; they never act directly from the email.

**AL_QBO_FAILURE, concretely (Scarlett called it out):** [button: Fix & retry this sync] → the QuickBooks panel deep-linked to THIS failed row with its Retry control in view (never the panel root); secondary links: the Stripe payment (external dashboard) and the enrollment/family record. Keep the verbatim error text — that part is already right.

**AL_AVAILABILITY_SHARED, concretely (Scarlett, from a live send):** "the student-schedule wizard on /admin/tutoring will suggest matching times" becomes [button: Schedule {studentFirstName} now] → the wizard with the student preselected and the just-shared availability pre-loaded (suggestions computed on arrival); secondary link to the student record showing the shared windows.

**AL_WEBHOOK_FAILURE, concretely (Scarlett confirmed, expanded):** replace "Check the Stripe dashboard and the enrollments table" with two buttons — [Open this payment in Stripe] → the exact checkout session / payment intent in the Stripe dashboard (**mode-aware URL**: test-mode objects need the /test/ prefix; live after cutover) · [Match to an enrollment] → the portal enrollments view pre-filtered to the payer's email. Keep the mismatch details verbatim. Plus, per Scarlett: the body states the **consequences ledger** so the reader knows the state of the world —

> **Because this payment isn't matched, none of this has happened yet:** the enrollment still shows unpaid · no confirmation email went to the family · the class email sequence isn't scheduled · **payment reminders for this family are NOT suppressed** (they could be dunned despite having paid) · no QuickBooks receipt exists.
>
> **Nothing retries automatically.** Once you match the payment (below), everything above happens on its own — confirmation, sequence, reminder cancellation, QuickBooks — exactly as if the webhook had matched.

- To make that promise true, add the missing mechanism: an admin **"Attach this payment to enrollment X"** one-click on the pre-filtered enrollments view, which runs the normal paid-webhook consequences end-to-end (confirmation, sequence scheduling, PR cancellation, QBO sync). Idempotent; logged by-hand on the family timeline.
- **General note for the AL pass:** where an alert has downstream consequences, the body carries this same two-part ledger — "not done yet" and "what happens automatically once you act" (the dunning and HOLD alerts already got theirs in PL-89/90).

## PL-93 · School/counselor comms timeline with open tracking ("are our nudges landing?")

Scarlett: the counselor's profile should show whether they've opened our emails — PL-83 covers families only. Extend the same timeline machinery to schools:

- **On the school admin view (and per contact):** every counselor-facing send to that school's contact emails — CD digest, CR1/2/3, FP/FP-alt, CX-C — sent + upcoming scheduled nudges + cancelled, each row with **delivered/opened status**, the automatic/by-hand badge, and the openable render.
- **Open state feeds the chase lines:** wherever a CR chase status renders (the PL-89 missing-details alert, the CR compose panel), append the open state — "nudged {date} — not yet opened" / "opened {date}". That's the difference between sending CR3 and picking up the phone.
- **Honesty in the UI:** opens are pixel-based and directional — some clients auto-fire them (false opens), strict ones block them (false unopens). Show the raw per-row status without editorializing; the reliable pattern is the all-unopened contact.
- Read-only; same preview-endpoint pattern, admin-scoped.

## PL-94 · Waitlist rescue: add back at a position, re-offer, over-cap override — and the rollover alert carries the controls

Scarlett's scenario: a family never saw the offer emails (PL-93 shows unopened), calls at hour 49 wanting the spot. Kelsie needs real tools, and the AL_WAITLIST_ROLLOVER alert itself must carry them (her explicit ask):

- **(a) Add back at a chosen position.** On the class waitlist panel, expired/declined/rolled families get "Add back to waitlist at #N" (picker, default #1; other positions shift; logged). Fairness rule: a **live 48h offer already out to another family is never revoked** — reinsertion at #1 makes the rescued family next after the current offer resolves.
- **(b) Re-offer the spot now.** Sends a fresh W2 claim with a fresh 48h clock. If the class is full (spot since claimed, or cap reached), the same action presents an explicit **over-cap confirm** — "this enrolls {student} at {n+1}/{cap} — sure?" — logged as an Ops override, never silent, mirroring the run-under-minimum philosophy (PL-91): the system informs, the Ops Director decides.
- **(c) AL_WAITLIST_ROLLOVER becomes the cockpit** (PL-92 standing rule): body gains the **open status of the offer + reminder emails** ("neither was opened — this expiry may be a spam-folder artifact; consider a call"), and the action row: [Re-offer the spot] · [Add back at #1] · [See the waitlist] — all admin-authed deep-links to the class's waitlist with the relevant row in view.
- Reinsertions and re-offers show on the family timeline (PL-83) badged by-hand; waitlist history keeps the original expiry so the record stays honest.

## PL-95 (small) · IN_DIGEST variants carry a "what happens from here" footer

Scarlett: same consequences-ledger idea, tuned for the instructor audience — reassurance about what's automatic, so the ping never reads like assigned homework. Per-variant composed footer (the variant machinery from PL-78):

- **min_met:** "Nothing you need to do. From here, automatically: families get the class-details email on {fourSendDate} — you'll receive an FYI copy · registration stays open through {regCloseDate}, and you'll get another ping if the class fills · the sessions are already on your calendar."
- **class_full:** "Registration is effectively done — you'll get the final count when it closes on {regCloseDate}. Nothing to do."
- **registration_closed:** "Final roster: {n} students. Families get their location reminder before day one (FYI to you) · attendance lives on your class page from the first session."
- **weekly:** "Nothing needed — this is just your weekly picture."

Samples updated per variant (PL-82 mechanism); wording editable in the registry after seeding.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-31.md` (batch 13 — eleven items, decided; PL-87 first).
>
> PL-87: real sends refuse to ship non-production origins — sendOnce scans outgoing HTML on real (non-test) sends for localhost/127.0.0.1/ngrok/anything ≠ the pinned production base URL and refuses loudly with an admin alert (ALLOW_REAL_EMAILS does not bypass this); real-send composition pins its base URL from production config, never the dev origin; sweep existing real-send renders for bad origins and re-send corrected copies where it matters (QA-PL76's CX-T at minimum); add the dev-shaped-environment refusal E2E. PL-85: collapse T3-T's coalesced deltas to one line per session: original state (as of the window's first change) → final state; round-trips produce no line, and an empty batch sends no email; attendance marks stay their own lines. Extend the PL-81 E2E for chained move+cancel and round-trip cases. PL-86: self-serve cancellation→tutoring conversion — tokenized link on CX_FAMILY's tutoring option → scanner-safe one-tap confirm stating the persisted offerHours terms → mints the package via the PL-84 machinery + Ops alert → the same page becomes the inline availability grid; CX_TUTORING_START demotes to a +1d follow-up in the self-serve path (unchanged as the immediate receipt when Kelsie converts from a reply, never both); admin shows self-serve vs Ops-Director conversions. PL-88: {classSummaryLine} names the school ("…in person at {schoolNickname} ({schoolFullName})", online equivalent), sample updated (school name consistent everywhere); IN_WELCOME is at v5 — don't reseed its copy. PL-89: AL_MISSING_DETAILS re-anchors to 3 days before #4's scheduled send (derived from the SEQUENCE offset), daily, copy led by the email deadline + CR chase status; AL_CLASS_DETAILS_HOLD copy acknowledges the email is now overdue to families; update code twins + reseed drafts + samples. PL-90: AL_DUNNING_EXHAUSTED body/subject per the doc — one charge retried three times, the emailed invoice link was the LAST automatic step ("nothing will retry from here"), personal follow-up framing with invoice + family links. PL-91: AL_MIN_ENROLLMENT fires at deadline−3d with count/min/cap + both clocks + FP status, spells out hold / extend-the-deadline (extension propagates to collateral, registration page, FP timing, and re-arms the checkpoint) / run-under-or-cancel, one follow-up if the deadline passes undecided; nothing automatic. PL-92: AL_OVERDUE_10/30 build-out per the doc — automatic-steps recap with delivery/open status; 30-day led by the late-fee decision with the full action row (apply-late-fee deep-link to THIS invoice, see-activity, manual-email compose); and the standing rule applied across the whole AL family: every alert deep-links its specific record + its decision's one-click actions, buttons land on admin-authed pages and never act from the email. PL-93: school/counselor comms timeline (PL-83 machinery scoped to the school's contact emails) with per-row delivered/opened status and openable renders; open state appended to CR chase-status lines everywhere they render; raw status, no editorializing. PL-94: waitlist rescue — add-back-at-position (live offers never revoked), re-offer with fresh 48h clock, explicit logged over-cap confirm; AL_WAITLIST_ROLLOVER gains the offer-emails' open status and the action row (re-offer / add back at #1 / see waitlist); everything on the family timeline as by-hand. PL-95: IN_DIGEST per-variant "what happens from here" footers (copy in the doc — min_met / class_full / registration_closed / weekly), composed via the variant machinery, samples per variant. Also per PL-92's expanded webhook spec: the consequences ledger + the admin "Attach this payment to enrollment X" one-click that runs the full paid-webhook consequences.
>
> Rules: PL-x IDs in commits; `git push` after committing; check this item off here when shipped.
