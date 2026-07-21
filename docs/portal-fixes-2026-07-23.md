# Portal fixes — batch 6 (July 2026, follows batch 5)

From Scarlett's continued email-flow testing (real sends, not just previews). Continues PL-x numbering. Six items; PL-60 is a **pre-launch blocker**.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · contact block on parent surfaces · `git push` after committing · PL-x IDs in commits · check items off here when shipped. All 12 original registry templates + NW/WR are LIVE — copy changes land as new template versions, not code edits. (#8b/#8b-n remain drafts under Scarlett's review; she just saved #8b v2.)

---

## PL-60 (pre-launch BLOCKER) · Action links render dead in real registered-template sends ✅

> **Shipped — root cause found, and it wasn't the registry.** Both dead sends came from a **dev-machine pipeline run against the shared production DB**: the July 17 ~22:xx PL-59 E2E ran the lifecycle cron on localhost, the sweep processes *every* class (not just QA rows), Roman's pending enrollment had just crossed the PR3 threshold, and the dev machine won the race against the next prod tick — so a real family got an email whose links were built from `http://localhost:3000` (dead anywhere but that machine). The WR QA send was the same run. Prod re-renders the identical row with a perfect absolute URL; the registry render path was never broken.
> Fixes: **(1)** `sendOnce` now refuses to email non-QA addresses from any dev environment (non-production, or a localhost link base) — suppressed before the row is claimed, so the production cron still delivers properly; `ALLOW_REAL_EMAILS=1` overrides deliberately. Verified live: re-running the same E2E now logs `[PL-60] suppressed … → williamraymondthomas@gmail.com` for the exact sends that caused the incident. **(2)** `sendOnce` also scans outgoing HTML for dead hrefs (empty, `#`, relative, unresolved `{variable}`) — loud error in prod, fatal in dev. **(3)** Committed audit `npm run regress:links`: renders every live template (sample context) AND the pipeline paths with a real enrollment context, failing on any dead/localhost href; it already caught and we fixed `{synapGroupLink}`'s `#` fallback (now falls back to the live portal link until a class's Synap group is set) and a `#` in the sample upsell block. **(4)** Expired resume links now land on the register page (slug URL) with a friendly "that link expired — nothing was charged, register again below" banner, verified in the browser.
Two confirmed cases of a real (non-test) email whose primary action link/button does nothing (href empty — in Gmail the button anchors to the message itself):
- **PR3 to Roman Desmond** (real send, Jul 17 ~22:xx UTC): the "Finalize Registration" button — `{resumePaymentLink}` — is dead. This is the revenue-recovery link.
- **WR_WAITLIST_RELEASE real QA send** (billy+pl59qa): the "Share your availability" link — `{availabilityLink}` — is dead. (The E8_ADDON_NUDGE *test*-send link being dead was sample data, now fixed by PL-56 — but WR was a real pipeline send.)
**Investigate:** URL-variable resolution in the DB-template render path for real sends. Both templates render from the registry; both failed to resolve a tokenized-link variable that the code originals resolved. Check whether the render context simply wasn't passed these values (e.g. the projector supplies them to code renders but not `renderRegistered`), and **audit every URL variable across live templates** ({resumePaymentLink}, {availabilityLink}, {approveLink}, {claimLink}, {intakeFormLink}, {invoiceUrl}, {calendarLink}, {schedulePdfLink}, {synapGroupLink}, {addonLink}…) with a test that fails on any empty href in a rendered send.
- Secondary check while in there: what *should* a resume link do after the enrollment expires (PR4 +6d)? A dead button is never acceptable; an expired link should land on a friendly "this registration expired — here's how to restart" page.

## PL-61 · Class minimums must be positive (+ sanity warnings)
The admin roster report showed Cape Town as "-1 min / 10 cap · runs (min -1 met)". Fix: (a) validation everywhere minimums are set (wizard, admin edit): integer ≥ 1; (b) non-blocking warning when in-person min < 8 or online min < 3 ("below the usual minimum for this class type — sure?"); (c) repair the Cape Town row's data; (d) the roster report should never render a nonsensical "min -1 met".

## PL-62 · Monthly proposal page: quick per-session changes + one-tap confirm from email
From the T1 proposal flow (real August proposal for Willie's family):
- **(a) Quick-change layer.** "Request changes" currently offers only a free-text box. Add a per-session step first: the proposed sessions listed with per-session actions (move / drop), where "move" surfaces alternative times from the **existing offered-slots machinery** (same ±2h computation the parent portal already uses for reschedules). Simple moves the family picks are applied automatically to the still-unconfirmed proposal (no fees — nothing is confirmed yet), recompute the total, and the family continues to confirm in the same sitting. The free-text box remains as the fallback for anything complex ("we need Thursdays now"), which still pauses the clock for Kelsie per the existing flow. Scenario to satisfy: "can't come Monday Aug 17" should be a two-tap fix, not a typed note and a wait.
- **(b) One-tap confirm.** The email's Confirm button currently lands on the proposal page where the family must press Confirm again. Make the email button confirm in one tap: land on the page with the confirmation already applied ("Schedule confirmed — thank you!"). **Implementation caution:** email scanners/prefetchers follow GET links — do NOT confirm on a bare GET fetch. Confirm via a JS-executed POST on page load (prefetchers don't execute JS), or an equivalent bot-safe pattern, so a corporate mail scanner can't silently confirm a month. Keep the request-changes path exactly one visible tap away on the landed page.

## PL-63 · Agreements: automatic chase + firm first-send language + alert copy
- **(a)** Admin alert copy: remove the internal jargon "§12 guard — " from the billed-without-agreement alert body (keep the alert itself — it's the backstop).
- **(b) Automatic nudges.** Stop relying on Kelsie manually re-sending agreement links. Same cadence pattern as the schedule-confirm flow: initial agreement send → +3d nudge → +7d second nudge + Ops Director alert; stops immediately on acceptance; never auto-escalates beyond the alert. Register the nudge as an editable template.
- **(c) Kind-but-firm first-send copy.** The first agreement email (and T8's policies paragraph) states plainly that sessions can't start unsigned. Approved direction (Scarlett): kind but firm — suggested line, editable in the registry: "One important note: we can't start {studentFirstName}'s sessions until this is signed — it takes about two minutes, and it protects your family as much as it protects us."
- **Scope note:** billing enforcement stays warn-not-block (the §12 behavior is unchanged); the firmness lives in the language and the automatic chase, so a billed-unsigned family represents a slipped crack, not the normal path.

## PL-64 · Physical address in the shared email footer
Add HGL's postal address to the standard footer every email renders (CAN-SPAM requires it for commercial messages — #8, #9, NW, WR are promotional in nature — and it's a mild deliverability/trust signal for everything else; include it uniformly for consistency). Footer line:

> Higher Ground Learning · 380 W. Pierpont Ave, Salt Lake City, UT 84101, USA · highergroundlearning.com · questions? Just reply to this email.

Store the address as an `app_settings` value (e.g. `business_address`) next to the contact info rather than hardcoding, seeded with the address above (including "USA" — many recipients are international school families), so an office move is a settings edit. One shared-footer change; verify it renders in both the code shell and registry-rendered sends.

## PL-65 · Mode-aware E5 subject (decided)
Scarlett chose fully mode-aware over a universal rewording. Add a subject-safe variable, e.g. `{locationNounTitle}`, resolving from the class's delivery mode: in-person → "Classroom location" · online → "Meeting link". Then publish E5's subject as "{locationNounTitle} for {className}" (new registry version — E5 is live). Real sends read "Classroom location for ISD SAT Prep" or "Meeting link for Nido SAT Prep". Check E5's preheader/body for the same assumption while in there.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-23.md` (batch 6 — six items; PL-60 is a pre-launch blocker).
>
> Do PL-60 first: find why `{resumePaymentLink}` (real PR3 send) and `{availabilityLink}` (real WR send) rendered as empty hrefs in registry-rendered emails, fix the render-context gap, audit every URL variable across all live templates, and add a test that fails on any empty href in a rendered send; also give expired resume links a friendly landing page. Then PL-61 (positive minimums + type-specific warnings + Cape Town data repair), PL-62 (per-session quick changes reusing the offered-slots machinery + bot-safe one-tap confirm from the email), PL-63 (drop "§12 guard —" from the alert, automatic agreement chase on the standard nudge cadence with an editable nudge template, and the firm first-send line), PL-64 (physical address incl. "USA" in the shared footer, sourced from a new `business_address` app_setting), and PL-65 (the `{locationNounTitle}` variable + a new E5 subject version: "{locationNounTitle} for {className}").
>
> Rules: PL-x IDs in commits; `git push` after committing; copy for live templates lands as new registry versions; standing copy rules apply; check items off in this doc as you ship.
