# Portal fixes — batch 22 (✅ READY — handed to Code July 28; 13 items, PL-207…219)

Closed and handed off July 28 (13 items). If this doc is extended after you've pulled it, wait for an explicit re-read ask. Suggested order in the handoff prompt: quick copy tier (209 · 210 · 215 · 216) → 217 → 212 → 211 → 213 → 208 → 214 (copy appendix at bottom is final — use verbatim) → 207 → 218 → 219 (v1 → v1.5; v2 is roadmap, do not build without a pull).

Next PL after this batch: **PL-220**.

**Decisions noted Jul 28:** campaigns work (PL-201 copy/rollout) is PUNTED for now — no campaign sends; campaign identity should use existing aliases hello@ or testprep@ (both exist) rather than creating offers@ (tell Code before campaigns resume).

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

**✅ SHIPPED (Jul 28).** New `TutoringAddonCard` state machine replaces the static line; all four states verified rendering live (A as Bruce's real parent session with the Scar Tissue fixture; B via the Reggie QA family; C/D via the ASF enrollment with a briefly-flipped start date, restored after). **Availability machinery reused, not rebuilt (the ship note you asked for):** the card's "Share availability" button opens the SAME tokenized `/availability/{token}` page from #0/E8 (`availabilityUrlFor(familyId)` + `?src=card`); submissions land in `student_availability` through the same API, fire the same AL_AVAILABILITY_SHARED ops alert, and feed the same wizard preload — the only addition is the `src=card` marker riding the existing form. **State A:** why-after-class explanation + share-availability → propose → confirm steps; timing toggle ("Start right away" / "Wait until the class is done") visible while class sessions are still ahead, stored on `enrollment_addons.tutoring_timing` (migration `20260820000003`, applied). **Kelsie sees the choice unambiguously:** "wait" → a "Wants 1-on-1 after the class" Needs Attention row (last class day named, family deep-linked) with a one-click **"push to my to-dos"** that pins a dashboard note carrying the suggested due date = last class day (verified: note created with date + family link, then cleared); "start now" → the availability-promise row now also fires for add-on families with NO engagement yet (they were invisible before) and says the family chose "start right away". **Email suppression:** completing the card flow (timing choice, or availability submitted via the card) stamps `portal_kickoff_done_at`, and the post-class kickoff sends — E8 scheduling AND its nudge — check it inside their send sweep and cancel with a logged reason; the non-purchaser #8 offer is untouched. **States B/D read the live pricing source** (`loadTutoringPackages()` pre/post + `packageSavings`) and D links the same `DISCOUNT_URL`/BESTSCORE as the #8 email (now a shared export, so they can't disagree). Three new-copy inline-boundary joins were caught by the PL-215 rule during verification ("SAT Prepclass") and fixed. Fixture left pristine (timing, stamp, and QA availability rows all reset).

## PL-208 — Nothing ever tells parents the portal exists (reported Jul 28)

Portal discovery today is only deep-links inside task emails (#0 "View your registration", T1 schedule page, availability page, receipts). No email or surface says "you have a family portal, here's what's in it, log in any time with just your email." Fix candidates (scope with Code):
- A short "your family portal" block in #0-parent and/or the thank-you (#1): what's there (schedule, receipts, diagnostic scores, calendar feed, tutoring), and that login is just their email — no password.
- A one-line portal pointer in the standing footer of transactional templates (transactional-safe: informational, not marketing).
- Parent-voiced, no shorthand.

**✅ SHIPPED (Jul 28).** Scoped as: (1) **#0-parent gets the full block** — "One more thing worth knowing: you have a family portal…" (what's inside: schedule, receipts, scores, calendar feed, tutoring; login is just this email, no password) — published as **E0_CONFIRM_PARENT v5** by patching your current active v4 body with an exact-string anchor guard (never re-seeded), code twin updated to match; renders clean through the editor's sample pipeline. The #1 thank-you was left alone on purpose — it's the personal billy-voice note, and the same block twice in two minutes reads like a pitch; veto welcome. (2) **Every standing footer (transactional AND relationship) now carries one line:** "Your Higher Ground portal is always at hgl-portal.vercel.app/portal — sign in with just this email address, no password needed." One choke point (`footerT`/`footerR` in email.ts), so every code-twin and registry send gets it — and the wording is audience-neutral because it's true for every recipient class (parents, tutors, school contacts all have email-only login). Verified through the real render path (footer line + address block both present, portal link pinned to production). Known edge, accepted: a pure prospect (inquiry-only, no records) who tries the portal gets the silent no-match login response — rare, harmless.

## PL-209 — Tutor upcoming-sessions header copy: name the Ops Director, name the places (reported Jul 28)

Current subtext: "These also live on your Google Calendar — reschedules and cancellations go through the office, and both places update automatically." Change "the office" to the Ops Director's actual name pulled from settings (currently Kelsie) — not hard-coded — and "both places" to "your portal and Google Calendar." E.g.: "...reschedules and cancellations go through {opsDirectorFirstName}, and your portal and Google Calendar both update automatically." File: `app/portal/tutor-view.tsx`.

**✅ SHIPPED (Jul 28).** The header now reads "…reschedules and cancellations go through {first name}, and your portal and Google Calendar both update automatically." The name is the first word of `contact_name` from app_settings (the PL-123 role record the contact-settings panel edits — same source every email's contact block uses), so changing the Ops Director in Settings changes this line too. If `contact_name` is unset, the copy falls back to "the office" rather than splitting the office-fallback string into a fake first name.

## PL-210 — Join buttons only live near session time (reported Jul 28)

Every session with a meeting-URL location currently shows an enabled Join button, even a week out — noise, and invites mis-clicks. Make Join active only within ~30 minutes of the session on either side (30 min before start through 30 min after end, or after start +30 — Code's call, say which). Outside the window, either hide the button or show a muted/disabled state so the tutor still knows it's an online session (muted state preferred — the online/in-person distinction is information). File: `app/portal/upcoming-sessions.tsx` (client component — window check can be client-side; no security concern, the URL is already the tutor's).

**✅ SHIPPED (Jul 28).** Window chosen: **30 minutes before start through 30 minutes after end** (covers a session that runs long without reviving week-old links). Outside the window the button renders muted ("Join · online", gray, with a hover note "The Join link goes live 30 minutes before the session") so the online/in-person distinction stays visible. The check re-evaluates every 60 seconds while the page is open, so a tutor who loaded the portal an hour early sees the button go live on its own — no reload.

## PL-211 — Warn when an engagement is scheduled with no location anywhere (reported Jul 28)

Engagement `location` is optional and falls back to the tutor's `default_location`; when both are empty, the tutor's upcoming list shows a row with no location and no Join, and the ICS/PDF schedule surfaces have no LOCATION either. Add a warning at engagement create/edit (wizard + `app/api/admin/tutoring/engagement/route.ts` path) when the engagement has no location AND the tutor has no default: don't hard-block (some setups may be legitimately TBD), but make the admin explicitly acknowledge "no location set — tutor and family won't see where/how to meet," and surface still-missing-location engagements as a Needs Attention row (deep-linked, per standing rule) so a TBD can't silently ride into session day. Current location-less rows in QA are the Roman fixture — intentional, don't "fix" the data.

**✅ SHIPPED (Jul 28).** Same walk-past pattern as the PL-197 overdraw flag: the route (the authority) returns 409 `needsLocationConfirm` when the engagement has no location AND the tutor has no default meeting link — on create, and on any edit that clears the location; the wizard and the schedules panel show the plain warning ("…the tutor and family won't see where or how to meet — not in the portal, the calendar, or the printable schedule") and only proceed on an explicit confirm. Never blocked, TBD stays legitimate. **Needs Attention row** "No session location set" (deep-links the family) is state-driven off live engagements: setting the engagement location, giving the tutor a default link, or pausing/ending clears it with no bookkeeping. Verified live: with the tutor's default link temporarily cleared, the dashboard grew the row for the Roman fixture and a location-less create 409'd with the tutor's name; restoring the link cleared the row on its own (fixture data untouched — Roman's engagement still has no location, which is correctly fine while Billy's zoom default exists). Note: the row fires only when NOTHING anywhere names a location — Roman's current QA rows (engagement empty, tutor default set) are not flagged, matching the doc's premise that both must be empty.

## PL-212 — Salaried tutors: track hours, don't pay hourly (reported Jul 28)

Some tutors are salaried (currently Eric) — paid the same regardless of hours tutored. We still want their sessions and timecards tracked exactly like any other tutor (scheduling, session notes, auto-completion, semi-monthly sweep, confirm/approve), but the timecard must show they are not paid hourly. Add a per-tutor pay-type flag on `instructors` (`hourly` default | `salaried`, editable in the tutors panel):

- Timecard generation/confirm/approve flows unchanged — hours are still real records.
- Salaried tutors' timecards carry a visible "Salaried — hours tracked for records; not paid hourly" label (tutor view AND staff approval view), plain English.
- The hours-only payroll CSV export must distinguish them: separate them out (own section or column flag) so the bookkeeper can't accidentally pay salaried hours as hourly. Coordinate with the bookkeeper one-pager if the export shape changes.
- Rare case, so keep it one flag — no salary amounts in the portal (rates and dollars live in QBO/payroll, standing rule).

Note: Billy and Kelsie are salaried but don't tutor, so they never generate timecards — no flag needed for non-tutors.

**✅ SHIPPED (Jul 28).** `instructors.pay_type` ('hourly' default | 'salaried'), migration `20260820000001` applied; **Eric Brown is flagged salaried in prod data**. Editing the flag is admin-only server-side — the PL-104 pay-titles guard trigger now covers both fields — and the tutors-panel editor shows managers a read-only line. Generation/confirm/approve untouched (hours stay real records). Labels: tutors-panel row chip; staff timecard row chip + a "Salaried — hours tracked for records; not paid hourly" line in the payroll-summary detail AND in the copy-for-QBO clipboard text; tutor's own Timecards header says "You're salaried — hours are tracked for records; they aren't paid hourly" (verified rendering via view-as). **Payroll CSV:** new `pay_type` column ("hourly" / "SALARIED — do not pay hourly") and salaried rows sort LAST so a bookkeeper running down the list can't sweep them in by momentum — bookkeeper one-pager should note the new column when it next gets touched.

## PL-213 — Team access panel + access lifecycle for staff and tutors (reported Jul 28)

Today the manager role is granted by hand-editing `profiles.role` in SQL — no UI. And access lifecycle has a hole: `deriveRoles` grants the instructor role from a bare `instructors` email match with NO `active` filter, so a tutor made inactive (PL-176) or not yet flipped on (`tutoring_active=false` rollout gate) can still log in and see the tutor view. Counselors already do this right (ended affiliation = no role); instructors should match.

1. **Admin-only "Team access" panel** (under Settings): list profiles with elevated roles; grant/revoke manager on any known email; show admins read-only with a note that admin comes from the `ADMIN_EMAILS` env allowlist (the allowlist stays the admin authority — no admin-granting UI, no privilege escalation path). Every change writes an audit line.
2. **Instructor role requires `instructors.active = true`** in `deriveRoles` (and any RLS that keys off instructor identity). Making a tutor inactive revokes portal access on next auth check, exactly like ending a counselor affiliation; reactivating restores it — history intact, nothing deleted. Decide + document whether `tutoring_active=false` (rollout gate) should also withhold the tutor view or just hide tutoring features; leaning: `active` gates login, `tutoring_active` gates tutoring surfaces.
3. So the lifecycle story is uniform and self-serve: hire a tutor = add them in the tutors panel (login works immediately); offboard = make inactive (login gone); counselors = end the affiliation; managers = toggle in Team access; admins = env allowlist.

**✅ SHIPPED (Jul 28).** (1) **The deriveRoles hole is closed:** instructor role now requires `instructors.active = true` (proven with compile-and-call: active → `["instructor"]`, flipped inactive → `[]` → no login email sends, restored → back). The portal page applies the same gate to both instructor-shaped views per load, and the four RLS policies that key off instructor identity (session-note read/write, coverage requests, student materials) were recreated with the active check — migration `20260820000002`, applied — so even an already-signed-in session reads nothing once inactive. Nothing is deleted; reactivating restores everything. (2) **Decision, as leaned:** `active` gates login; `tutoring_active` gates tutoring surfaces only. Concretely: a rollout-gated tutor (`tutoring_active=false`, like the not-yet-onboarded seeds) can still sign in but has no tutor view until flipped on; truly offboarding someone is the **Instructors-page inactive flag** (PL-176) — that kills login. Worth knowing: the tutors panel's "retire" button only clears `tutoring_active` (tutor surfaces gone, login intact) — if retire should ALSO end login, say so and I'll point it at `active`. **Veto welcome on either lean.** (3) **Team access panel** under Settings (admin-only — managers never see it, the API 403s them): admins listed read-only with the ADMIN_EMAILS note (allowlisted-but-never-signed-in addresses still listed; a stored admin NOT on the allowlist gets an amber flag); grant/revoke manager with plain-English guardrails — unknown addresses refused ("add them as a tutor, contact, or family first"), allowlisted admins refused, revoke falls back to whatever the person's records derive (verified round-trip live: grant → manager appears → revoke → demoted to parent, both audit lines written to the new `team_access_audit` table and shown in the panel's Recent changes).

## PL-214 — Counselor "class is ready" email + sample announcement + portal line in the digest (authored Jul 28)

Fills a confirmed gap: the counselor sequence (CD, CR1-3, FP/FP-alt, CX-C) never says "your class is set up" and never mentions the portal. Replaces the manual email Billy sends today after class setup. Three pieces (final copy in the batch-22 copy appendix at the bottom of this doc — use it verbatim through the template editor):

1. **CS — Counselor class-confirmed welcome.** From William Thomas <billy@> (relationship tier). Trigger: admin-initiated send when the class is fully set up (schedule + price confirmed, registration live — instructor may still be TBD until minimum enrollment) — a button on the class admin view, not a blind automation. Attaches parent letter PDF + student flyer PDF/JPG (generated fresh at send). Body: sales-page link + deadline + first session, what each attachment is for, and the portal intro (sign in with just this email at {portalLink}; live enrollment, roster + attendance + diagnostic scores, past classes + results, always-current collateral downloads incl. formats/languages — `{collateralLanguagesPhrase}` renders only when the school has a second collateral language). Ends with the sample announcement below.
2. **SA — sample announcement block** rendered at the bottom of CS for the counselor to forward to students/parents: partnership intro, why-HGL list, outside-school-hours line, registration managed by HGL, capped at {classCapacity} FCFS, registration link + deadline, info@ for questions.
3. **CD digest addition:** one line pointing at the portal ("See live counts and scores any time — sign in at {portalLink} with this email.").

Audience test applies throughout; samples through the real composer; CS is transactional-adjacent but from billy@ — footer per the #1 thank-you pattern.

**✅ SHIPPED (Jul 28).** (1) **CS_CLASS_CONFIRMED** seeded from the appendix copy verbatim (SA renders at the bottom under "A sample announcement you can forward to students and parents:") and set **LIVE** — the copy is final and the send is a manual button, so there's deliberately no code twin to drift. From billy@, transactional footer. Five new template variables registered with samples ({salesPageLink} · {collateralLanguagesPhrase} · {courseDatesPhrase} · {enrollmentDeadline} · {classCapacity}); {salesPageLink} comes from the class's stored short link (`https://hgl.co/{slug}` form) — never the raw /register URL. (2) **The send** is a button on the class's collateral card ("Send 'class is ready' welcome to the school"): goes to every ACTIVE school-contact affiliation, attaches parent letter PDF + student flyer PDF **and** JPG generated fresh from live class data (same Phase 4.5 render as the download endpoints; primary collateral language — the portal carries every format/language), refuses plainly when the class isn't ready (missing sessions / short link / deadline — each named), refuses with instructions if CS is ever flipped un-live, and dedupes same-day double-presses while allowing a genuine re-announce tomorrow. **Verified live end-to-end:** missing-short-link refusal → set `hgl.co/isd` on the ISD QA class → real send DELIVERED to billy+qa-isd-counselor@ with all three attachments (that's your review copy, subject "Everything's ready for ISD SAT Prep at ISD"); second press same day → "already sent today", nothing went out. (3) **CD digest v2 published** (live): one line after the class list — "See live counts and scores any time — sign in at {portalLink} with this email." — patched into the current active body with an anchor guard; code twin updated to match. sendOnce grew an `attachments` option for this (files still deliberately linked, not attached, everywhere else).

## PL-215 — Unsubscribe page: missing space after the email address (reported Jul 28)

The campaigns unsubscribe page (PL-201) renders "billy@highergroundlearning.comwill stop receiving offers..." — bold email address runs straight into "will". Add the space (and check the confirmation state + one-click POST result page for the same join).

**✅ SHIPPED (Jul 28).** Both page states fixed with explicit `{' '}` and verified rendering in the browser ("billy@highergroundlearning.com will stop…" / "…com won't receive…"). The one-click POST endpoint returns JSON to the mail client (RFC 8058 — no visible page), so there was nothing to fix there. **Root cause pinned down with a probe page:** this Next version's compiler eats the boundary space after an inline element when the following text chunk continues onto the next source line AND the JSX sits inside a fragment/conditional branch — same-line-only chunks and top-level elements keep their space (this sharpens the batch-16 "JSX eats inline-boundary spaces" lesson). A mechanical sweep then found 24 more at-risk joins (`</strong> text…`-continuing-to-next-line) across parent-facing pages — agreement accepted, intake thanks, autopay on, waitlist decline, reschedule fee note, register waitlist position, and admin panels — all rewritten to the explicit `{' '}` form (byte-identical render where the space already survived, fixes any that were silently joined).

## PL-216 — Two copy nits from the PL-200 sentinel run (reported Jul 28)

1. **Degenerate T1 period label:** when the mid-month remainder is a single day, T1's subject/label reads "QA's tutoring schedule for July 31–31". Collapse start==end ranges to just "July 31" (and generally "July 29–31" style stays for real ranges).
2. **Plural bug in the billed-without-agreement admin alert:** AL subject reads "[HGL Admin] 1 tutoring families billed without a signed agreement" — singular/plural the count ("1 tutoring family" / "2 tutoring families"). Sweep sibling alerts for the same countable-noun pattern.

**✅ SHIPPED (Jul 28).** (1) A one-day mid-month remainder now labels "July 31", real ranges keep "July 29–31" (fix in the generation label builder, so subject, body, and {tutoringMonthLabel} all agree). (2) The plural came from the registry template — the code twin already pluralized, but live AL_UNAGREED's subject hard-coded "tutoring families" around a bare number. Fixed structurally: the noun phrase moved INTO the variable ({alertCounts} = "1 tutoring family" / "2 tutoring families") so subject and count can never disagree — **AL_UNAGREED v2 published (live, `scripts/seed-pl216-al-unagreed.mjs`)**, caller + per-template sample updated. Sweep: every other count-bearing alert subject uses phrase variables ({digestCountsSummary}, {scheduleChangeCountPhrase}, ticker-style {alertCounts}) or already pluralizes; one more real case found and fixed — the generation-failure alert could read "0 of 1 families completed" (now "family").

## PL-217 — Phone-width + a11y pass findings (Jul 28 pass; all minor, parent surfaces held up well)

Checked at 390px: parent portal (sessions list wraps cleanly, request-a-change reachable), registration form (fields + paired name columns fit; Add-another-student and payment CTA full-width), tutor view (rows wrap, Join drops to its own line with a fine tap target), admin dashboard (cards stack correctly). Findings:

1. **Low-contrast muted text sweep (a11y, parent-facing):** the small gray annotations ("Higher Ground Learning" location strings, "times shown in..." notes, timestamp captions) render in ~gray-400 at 12px — roughly 2.5:1 on white, below WCAG AA (4.5:1 for small text). Bump the muted-text tone one step darker (gray-500/600) everywhere it carries information a parent needs.
2. **Admin topline nav overflows at narrow widths with no affordance** — at 390px the tab row cuts off ("Cla...") with no wrap, hamburger, or scroll hint. Admin is a desktop tool so low priority, but Kelsie will open it on a phone eventually: allow horizontal scroll with a visible fade/hint, or wrap.
3. Not-a-bug note: ISD registration page says "(times shown in Mexico City time)" — that's the QA school record's timezone, not a display bug. Real ISD gets a real timezone at import.

**✅ SHIPPED (Jul 28).** (1) 49 informational gray-400 annotations on family/tutor/counselor surfaces (portal, register, tutoring token pages) bumped to gray-500 — 4.6:1 on white, AA for small text. Seven deliberate keeps stay muted: transient loading states ("Loading attendance…", "checking available times…"), the "or" divider, and the PL-210 disabled Join chip — states, not information. Admin surfaces left alone per the finding's parent-facing scope. (2) Admin topline at phone width: the bar now shows a right-edge fade into the nav's slate while more tabs are off-screen (IntersectionObserver on an end-of-list sentinel — tracks scroll AND resize), disappearing at the end of the row; side padding tightens at phone width so more tabs fit. Verified at 375px logged in as admin: fade present at "Tutoring", scroll to end → "Settings" crisp, no fade; fresh-load console clean.

## PL-218 — Tutor hours breakdown report (replaces the hand-built Google Calendar spreadsheet) (reported Jul 28)

Scarlett built this by hand from Google Calendar (per-tutor tabs; rows = work category; columns = month; totals/averages; in-person vs online split; price/revenue). The portal already captures every input — automate it as an admin report (alongside the PL-204 term report):

- **Shape:** pick a tutor (or all) + a date range → matrix of hours by **work category × month**. Categories from existing data, not a new taxonomy: 1-on-1 by `subjects.category` + subject (ACT/SAT, subject tutoring, GRE/GMAT...), class/workshop sessions as their own rows (the PL-103 timecard work-type split), consults from the leads pipeline (30-min consult entries). Row totals, monthly totals, per-row average hours/month.
- **In-person vs online split** row (from session/engagement location), with % of total — matches the spreadsheet's Tutoring In-person/Online block.
- **Revenue column** per category reads the SAME paid columns the QBO sync reads (PL-204 principle — can't structurally disagree). List price column from `subjects.hourly_rate` / package pricing where it applies.
- **NO wages column** — pay rates and dollar amounts live in QBO (standing rule; portal is hours-only for pay). The spreadsheet's Wages/Difference math stays a QBO-side join; the report's CSV export should make that join easy (stable category keys, hours totals).
- **CSV export** of the matrix so the bookkeeper/owners can do wage math in their own tools.
- Admin-only (manager sees hours but this report carries revenue — follow the PL-204 amendment: aggregate revenue admin-only; if that makes it awkward, split an hours-only manager variant).
- Honest-data note: report starts at portal history — pre-portal months render as empty, not zero-filled fake data. Label the range accordingly.

**✅ SHIPPED (Jul 28).** `/admin/report/tutor-hours` (cross-linked with the PL-204 term report), fed by `/api/admin/tutor-hours` over new leaf `tutor-hours-report.ts`. **Shape:** tutor picker (or all) + month range → matrix of hours by work category × month with row totals, monthly totals, and per-row average. **Categories from existing data:** 1-on-1 by `subjects.category` + subject (plain-English labels, e.g. "SAT (Test prep)"); PL-103 pay-type titles as their own rows; class/workshop sessions as one row (payable = past, class not cancelled — the timecard rule throughout); consults from `leads.consult_at` matched to the tutor by `consult_owner_email`, 0.5h each. **In-person vs online split** with % of total (engagement location → tutor default; consult mode; class delivery mode). **Revenue** (admin-only) = PAID `tutoring_invoices` → their session-linked `tutoring_invoice_lines` amounts per category — the exact rows QBO sync reads; package-covered hours honestly show $0 line revenue (the dollars landed at package purchase, in the term report's packages table). List-rate column from `subjects.hourly_rate`. **NO wages anywhere**; the CSV export carries stable machine keys (`1on1:test_prep:SAT`, `worktype:{title}`, `class:Class/Workshop`, `consult:30min`) as the QBO-side join handle. **Role split structural:** managers get the hours-only payload, dollar fields removed server-side — `regress:report` grew to 12 checks including a deep key-scan of the tutor-hours manager payload (zero dollar-shaped keys) and stable-key format. Honest-data label renders ("Portal history starts {date} — earlier months are empty because the data predates the portal"). Verified live: real July data shows 5 category rows, the $40 paid SAT line attributed, 2h in-person / 8h online split.

## PL-219 — Class performance report in the portal (replaces the hand-built "Digital SAT Course Report" sheet) (reported Jul 28; platform capability — v1 + roadmap)

Scarlett hand-builds a per-class report (score data, performance graphs, survey results, cover sheet). Nearly all inputs already live in the portal (student_scores w/ sections, attendance_records, enrollments, instructors). Build it as a generated, role-scoped report — never stale, no Sheets archaeology. Charts follow the portal design system (the sheet's colors/formatting are explicitly what she wants to leave behind).

**v1 — per-class report, computed from live data:**
- Score block: per-student initial vs final diagnostic by section, points gained, superscore, attendance %; class averages row. (Blank where a student skipped a test — honest data, no zero-fill.)
- Graphs: initial vs final/superscore composite · class average section scores (initial/final) · average increase bucketed by initial score · attendance average. Dataviz per design system, readable in print.
- **Role scoping:** counselor sees their school's classes (extends the live counselor view — same RLS); instructor sees their own classes; admin/manager see all. Per-student names visible to all three (they already see rosters/scores today) — but see the shareable variant below.
- **Shareable/prospect variants (admin-generated, two flavors):** PDF one-pager riding the Phase 4.5 collateral machinery — (a) **anonymized**: averages, gains, distributions, testimonial-ready survey stats, no student names — for prospecting; (b) **named**: same layout with real per-student rows, for schools that prefer to see it that way (existing counselor relationship — they already see this data in the portal). Admin picks the flavor at generation; the named one is clearly labeled not-for-marketing.

**v1.5 — structured post-class survey (the missing input):**
- Today satisfaction/recommend/instructor-rating/most-useful come from a Google Form the instructor is supposed to share in class — and often doesn't. Portal survey with TWO delivery channels off one survey, and NO login for either (never the magic-link/OTP dance for a survey):
  - **Context never asked:** the token carries class → school, instructor, class type, SAT/ACT branch. The Google Form's school/instructor/which-class questions and section-branching are deleted, not ported.
  - **In-class:** instructor's class view carries a class-level tokenized link + QR (availability-page trick, signed, no auth). **In-class responses are always anonymous — no name picking** (a roster picker invites wrong-name pranks and leaks classmate names; decided Jul 28). Named feedback happens only via the per-student email link, which can't be faked. **QR access must be effortless in the moment:** a prominent "Show survey QR" button on the instructor's class view (surfaces automatically on/near the final session date), opening a full-screen QR + short-link display made for projecting; same button visible to admin/manager on the class.
  - **Email:** automated after the final session regardless of the instructor, per-student pre-bound link (the ONLY named channel), one reminder to non-responders (reminder copy: "already did this in class? ignore us" — anonymous in-class responses can't be matched, accepted tradeoff).
  - **Anonymity is honest:** in-class is anonymous structurally; on the email link a "submit anonymously" checkbox discards the student link at submission — only a responded-bit survives (for reminder suppression). Admin genuinely cannot see who.
  - Responses land on the class, feed the report's survey block. Keep #7's Google-review ask separate (public review ≠ private feedback).

**v2 — aggregate + comparison (admin/manager; comparisons ADMIN-ONLY):**
- Aggregate across classes: avg gain by class type/school/term, attendance vs gain, survey trends — "what's working," with filters composing like PL-204. Survey data gets the SAME scoping as scores: satisfaction aggregates by instructor across classes, by school across a season, by class type.
- **Instructor comparison admin-only** (avg score gains, satisfaction ratings, attendance side by side — one comparison surface for both scores and survey results) — it's a personnel surface; never visible to instructors or counselors.

*(Still on the radar from prior sessions: the Students-header mixed-units count ("3 students" vs "Current (4)") · duplicate identical weekly slots accepted without warning · anything from the batch-21 verification pass.)*

---

## Batch-22 copy appendix — PL-214 final copy

### CS — Counselor class-confirmed welcome
**From:** William Thomas <billy@> · **Trigger:** admin send when class fully set up · **Attachments:** parent letter PDF, student flyer PDF + JPG
**Subject:** Everything's ready for {className} at {schoolNickname}
**Preheader:** Registration is live — materials attached, and a sample announcement you can forward.

Hi {counselorFirstName},

Good news — everything is set up for the {className} class at {schoolName}. Registration is live, the course calendar is set, and families can sign up here:

[{salesPageLink}]({salesPageLink})

*({salesPageLink} = the Squarespace sales page, hgl.co/{schoolSlug} e.g. hgl.co/aisj — the sales layer; its Register button lands on the portal's Stripe registration page. NOT the raw /register/{slug} link.)*

Registration closes **{enrollmentDeadline}**, and the first session is {firstSessionDate}. I've attached the materials for you:

- A **letter** meant to be shared with parents (forward it in your parent communications, or print it)
- A **flyer** meant for students — it works well on bulletin boards, hallway screens, and in student newsletters

One more thing that makes your life easier: you have a **school portal** with Higher Ground. Sign in at [{portalLink}]({portalLink}) with just this email address — no password, we'll send you a login link. In it you'll find live enrollment for {className} (no more asking us for a count), your student roster, attendance, and diagnostic scores once the class is underway, every past class at {schoolNickname} with its results, and fresh downloads of the letter and flyer in every format{collateralLanguagesPhrase} — always reflecting the latest class details, so you never have to worry about a stale copy.

Below is a sample email you could use to introduce the course to students and parents. And as always — if you'd like any changes to the schedule or anything else, just reply. I'm happy to help however I can.

Best,

William Thomas

### SA — Sample announcement (rendered at the bottom of CS)

Greetings Students and Parents,

I have some exciting news to share: {schoolNickname} is partnering with Higher Ground Learning ([www.highergroundlearning.com](https://www.highergroundlearning.com)), a US-based test preparation company, to offer {classType} prep to our students.

We selected Higher Ground for many reasons, including excellent references from peer international schools, a long-standing record of integrity in preparing students for college admission exams, highly qualified tutors who provide both group and one-on-one support, and a teaching approach aligned with what {schoolNickname} believes is best practice.

The course runs {courseDatesPhrase}, with all sessions held outside of school hours. As this is a partnership and not a school-offered course, registration is managed directly by Higher Ground. To provide personalized attention, the class is capped at {classCapacity} students, first come, first served.

**Register here: [{salesPageLink}]({salesPageLink})** — registration closes {enrollmentDeadline}.

If you have questions about the course, feel free to reach out to Higher Ground directly at [info@highergroundlearning.com](mailto:info@highergroundlearning.com).

### CD digest — added line (after the class list block)

See live counts and scores any time — sign in at [{portalLink}]({portalLink}) with this email.
