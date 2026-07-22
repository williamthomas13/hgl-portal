# Portal fixes — batch 10 (July 2026, follows batch 9)

Seven items from Scarlett's continuing test-send review (#9, PR2/PR4, W2, LR, admin alerts, #0, CX follow-through). Continues PL-x numbering.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · contact block on parent surfaces · `git push` after committing · PL-x IDs in commits · check items off here when shipped · copy for live templates lands as new registry versions.

**Editor context (already done, not work):** LR v2 saved by Scarlett's review — subject is now `{youre_or_name_is} in — …`, "please complete it" → "{you_or_name} should complete it", "To get in" → "To get {you_or_name} in". PL-71c below finishes that paragraph. #8 v3 (student-voiced conversion) also already saved. Don't re-seed either except where PL-71 says.

---

## PL-70 · Test-send sample links must land somewhere human (+ #9's sample must show all three packages) ✅

> **Shipped.** **(a)** `/test-link` static page ("You clicked a sample link from a test email…"); every SAMPLE_* app URL now points there (resume, claim, addon, proposal + one-tap, approve, availability, unsubscribe, calendar, invoice, intake, agreements, autopay, schedule PDF, classroom form, digest frequency links, registration short link). Exempt on purpose: portal link (real page), compass/review/discount/FAQ (real external pages), the digest sample's register link (a real class slug). **(b)** `/link-help` friendly page with reason variants; invalid tokens on `/api/resume-payment`, `/api/waitlist/claim`, and `/api/addons/checkout` now 303 there instead of raw JSON (curl-verified) — expired offers get the "passed to the next family" variant, ended pre-class offers their own. The unsubscribe and counselor-digest GETs already rendered friendly HTML; counselor classroom/availability flows are pages with friendly not-found cards. **(c)** #9's sample block is now the real three-package compose — 5h save $50 / 10h save $250 / 15h save $525, straight from the live `packageSavings` figures — hrefs → `/test-link`. **(d)** QA naming rule adopted: all fixtures now use distinct names (QA-PL55-Parent / QA-PL55-Student, etc.) across regress-cancel-class, regress-resume-addon, and the PL-59/62/63 E2E scripts, assertions updated. Link audit still 90/90.

Three sightings, one root cause — sample URL values in test-sends point at tokens/pages that don't exist:

- **PR2/PR4 test-sends:** "Finalize Registration" → `/api/resume-payment?e=sample` → raw JSON `{"error":"Invalid link."}`. (Real sends are fine — PL-60's audit covers them; this is the sample token being rejected.)
- **#9 test-send:** the package button → `/addons/sample` → nothing.
- **W2 test-send:** the claim-spot button → `/api/waitlist/claim?e=sample` → same story.
- **#9 shows ONE button (5-hour):** `SAMPLE_EXTRA.upsellPackagesBlock` fakes a single button. The real compose (`tutoringUpsellEmail`) maps over every configured package — real sends get all three (5/10/15) — so this is a sample-data illusion, but it misled review (again).

Fix:
- **(a) Friendly sample-link landing.** Add a tiny static page (suggest `/test-link`): "You clicked a sample link from a test email. Real emails link the family to their actual page." Point every SAMPLE_* URL value at it (resume link, addon link, claim link, proposal links, availability, etc.) — a test-send should never dead-end a human. Exempt only samples that already land on a real working demo page on purpose.
- **(b) Invalid tokens get the friendly page too.** `/api/resume-payment` returns raw JSON `{"error":"Invalid link."}` (route line ~27) for an invalid token, while an *expired* one gets PL-60's friendly `?expired=1` redirect. Humans hit invalid links (truncated URLs, forwarded emails). Redirect invalid GETs to a friendly "this link isn't valid — here's how to restart or reach us" page (the expired page's copy generalizes fine). Sweep the other tokenized GET endpoints (claim, proposal, availability, approve…) for the same raw-JSON-to-a-human pattern.
- **(c) #9 sample block** becomes three buttons (5/10/15 hours with realistic savings figures matching `packageSavings`), hrefs → the (a) landing. PL-56 standard: samples mirror what the send code actually builds.
- **(d) QA fixture naming convention (standing rule from here on).** QA fixtures must give parents and students distinct names — "QA-PL54 Parent" / "QA-PL54 Student", like the newer fixtures already do — never the same string for both. Identical names made a correct CX-W render read as a personalization bug ("Hi QA-PL54 … the class that QA-PL54 was waitlisted for"), the third false alarm from indistinct QA/sample data. Rename any existing fixtures that share one name across roles (they're all purged at cutover anyway).

## PL-71 · Mode-aware "where classes happen" sentence (#4, #5, LR + the PL-68 preview) + LR pass-along clause ✅

> **Shipped.** **(a)** `classLocationTailText/Html` is now the one mode-aware builder (in-person → "in Room 204" · online → "online — here's the meeting link: <link>", anchored in email HTML; online with no link yet → "online — we'll send the meeting link before class"). Exposed as composed `{classLocationLine}` (follows "take place", so each template keeps its own casing/tense framing); **#4 v3** and **#5 v4** published with it — verified rendering both modes, and #5's online render pairs correctly with its PL-65 "Meeting link for …" subject. **(b)** LR's `{classDetailsBlock}` resolver and code twin both route through the builder — "The instructor will be Jordan Rivera, and classes take place in Room 204." / "…take place online — here's the meeting link: …" — full instructor name kept. **(c)** The entry previews render from `classLocationSentence(location, deliveryMode)`: the wizard hint follows the selected delivery mode; the counselor room form stays in-person (classroom requests only exist for in-person classes). **(d)** `{together_or_blank}` added (parent: " — you can do it together or just pass this along to {studentFirstName}" · student: empty); **LR v3** published with "…provide some quick basic info{together_or_blank}." — verified: parent send carries the clause, student send doesn't. 12/12 render checks; ready for your test-send re-review.

**The online gap (found answering Scarlett's "good for online too?" question — answer was no):** `{classroom}` resolves via `classroomValue()`, which for an online class returns the **meeting-link URL**. So #4 v2/#5 v3's "all classes will take place in {classroom}" would render "…take place in https://zoom.us/…" for online classes, and LR's composed `{classDetailsBlock}` says "…classes take place at <url>". Grammatical for rooms, wrong for links.

- **(a) One mode-aware sentence source.** Extend the PL-68 helper (`classLocationSentence`) into the single mode-aware builder:
  - in-person → "All classes will take place in Room 204."
  - online → "All classes will take place online — here's the meeting link: <link>."
  Expose it as a composed variable (suggest `{classLocationLine}`; keep bold-ability in the templates) and seed **#4 v3** and **#5 v4** replacing the "all classes will take place in {classroom}" chunk with it. Casing flexibility ("All classes…" vs "…all classes…") — mirror how each template embeds it today.
- **(b) LR's `{classDetailsBlock}`** uses the same builder: "The instructor will be {instructorName}, and classes take place in Room 204." / "…and classes take place online — here's the meeting link: <link>." (LR keeps the instructor's **full** name — first-introduction rule.) Also change its current "at" → the mode-aware form; that was Scarlett's original ask here.
- **(c) PL-68 preview follows the class's delivery mode** — the admin/counselor "Families will see:" hint should show the online sentence for online classes, since it renders from the same helper.
- **(d) LR pass-along clause.** Scarlett wants LR's diagnostic instructions tailored like #2-P v2 (clear the parent doesn't have to do it themselves). Needs a parent-only clause conditional (nothing existing fits): add e.g. `{together_or_blank}` → parent: " — you can do it together or just pass this along to {studentFirstName}" · student: "" (empty). Seed **LR v3**: "To get {you_or_name} in: click below, hit "register," and provide some quick basic info{together_or_blank}."
- Scarlett re-reviews all of these via test-send after ship.

## PL-72 · W2: let a family decline the spot early so it cascades before the deadline

Scenario (Scarlett): a parent knows they don't want the offered spot, but class starts in <48h — the next family in line shouldn't lose class days waiting for the deadline to lapse.

- **New tokenized decline flow.** W2 gets a decline link next to the claim button. **Bot-safety (same caution as PL-62):** the emailed link is a GET that lands on a confirm page — the decline itself is a JS-executed POST behind one visible tap ("Release the spot") so a mail scanner can never silently give a spot away. Idempotent: a second visit shows the friendly already-done state.
- **On confirmed decline:** mark the offer declined, and immediately run the same cascade the deadline expiry runs (next family gets their W2 with a fresh 48h clock — no waiting out the old one). Log it like the deadline path does; the admin waitlist panel shows the offer as declined rather than expired.
- **Interest row stays** (consistent with the WR/PL-54 principle: declining costs nothing) — they still hear when a future class opens. Code's call on wording if the confirm page mentions it.
- **W2 copy (seed as new version, Scarlett's wording):**

> If your plans have changed and you no longer need the spot, [click here to let us know]({declineLink}). It'll also pass to the next family automatically after the deadline.

- Sample value for `{declineLink}` → the PL-70 `/test-link` landing.

## PL-73 · Registration-alert count reads as a puzzle: "(1 / 8 min / 10 cap)" → "1 enrolled / 8 min / 10 cap" ✅

> **Shipped.** Code twin (the on-wire compose) now renders "1 enrolled / 8 min / 10 cap", pending as "1 enrolled + 1 pending / …"; the webhook's `{alertCounts}` compose and all sample data match. The AL_REGISTRATION draft's subject/body carry the count via `{alertCounts}`, so no template text needed reseeding — samples were the only registry-side change. The roster report builds its own verdict strings (already labeled) and doesn't use this builder.

The `[HGL Admin] New registration` alert's count string (`email.ts` ~line 1896: `` `${taken} / ${opts.minEnrollment} min / ${opts.capacity} cap` ``) takes a beat to parse — the first number is unlabeled. Change the compose to `"${taken} enrolled / ${opts.minEnrollment} min / ${opts.capacity} cap"`. Update everywhere that string renders (alert body/subject, roster report if it uses the same builder), the registered draft's sample data, and any golden-render fixtures. The alert is a PL-66 code-copy draft, so fix the **code twin** (that's what's on the wire) and reseed the draft to match.

## PL-74 · Escalation alert: one-click "restart the chase" (decided, with guardrails)

The `[HGL Admin] Policies still unsigned` escalation says "it's a phone-call matter now… link can be re-sent from /admin/agreements." Scarlett wants a button to restart the 3-nudge automatic chase so it doesn't *have* to become a phone call. Agreed, with two design guardrails:

- **The email button deep-links to admin, it doesn't act directly.** Action-from-email = scanner risk + auth headaches. The alert's button lands on the agreement's row in `/admin/agreements` (admin-authed), which gets a one-click **"Restart automatic nudges"** action: immediately re-sends the agreement email (AG v2 copy) and re-arms the +3d / +7d nudge cadence. One extra click over in-email action, but safe and consistent with everything else.
- **Track rounds so it can't become an infinite snooze.** Record chase round on the agreement. The restarted cycle runs identically, but if it *also* completes unsigned, the next escalation alert says so plainly: "Second automatic chase completed — this one really does need a call." No hard cap on the Ops Director restarting again (her judgment wins), but the alert stops pretending another email round is the plan.
- Log restarts in the send history like everything else; the admin agreements panel shows "chase restarted {date} (round 2)".

## PL-75 · "Order Summary" heading → "Enrollment Summary" (code-composed) ✅

> **Shipped.** `orderSummaryBlock` renders "Enrollment Summary" (shows in #0-P and LR's parent summary, as desired); the hardcoded #0 twin's subject and the seed now match the live "Enrollment Confirmed — {className}". Variable name unchanged.

Scarlett renamed #0-P's subject to "Enrollment Confirmed — {className}" in the editor (v4, live). The matching body heading lives in code: `orderSummaryBlock`'s resolver (`comms-variables.ts` ~line 459) renders `<h3>Order Summary</h3>`. Change to **"Enrollment Summary"**. It renders in #0-P and LR (empty on student sends) — both get the new heading, which is desired. Also update the hardcoded #0 twin's subject (`email.ts` ~line 243, "Order Confirmed — ") to match the live registry subject, just to keep the twins honest. Variable *name* stays `{orderSummaryBlock}` (internal; renaming would break existing template bodies).

## PL-76 · CX reply "we want the 1-on-1 tutoring option" → one-click conversion into the standard pipeline

CX_FAMILY invites a reply with the family's preference (deliberately personal — keep that). The gap is back-office: when a family replies choosing tutoring, every piece exists (family + student records, the PL-53 tokenized availability page, wizard suggestions, PL-41 approval, welcome email) but the glue is manual — Kelsie would have to hand-craft each step. Add a **"Convert to 1-on-1 tutoring"** one-click on the cancelled enrollment (admin enrollment/cancellation view):

- **(a) Credit.** Record the cancelled class's paid amount as tutoring credit per the CX offer. Implement as a **Stripe customer credit balance** (invoices consume it automatically — no bespoke discount logic; works in sandbox now), mirrored visibly on the family record in admin ("$899 cancellation credit — applied to future tutoring invoices") and mentioned in the wizard when proposing their first month.
- **(b) Availability request email.** Sends the family the tokenized availability link (the existing PL-53 family-scoped page — reusable/idempotent). Register the email as an editable template (suggest `CX_TUTORING_START`, from the PL-50 configured contact): warm, short, "you chose 1-on-1 — share when {studentFirstName} is available and we'll propose times," and it should acknowledge the credit ("your {className} payment is applied as credit toward these sessions").
- **(c) Standard pipeline from there.** Availability-shared Ops alert (exists) → wizard (their availability pre-loaded) → PL-41 approval → welcome email. No new pipeline — this is an on-ramp to the existing one.
- **(d) Idempotent + reversible-ish.** Clicking twice re-offers to resend the availability email rather than double-crediting; the credit entry is a visible record Kelsie can adjust if the family changes course (e.g., takes the refund after all).

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-28.md` (batch 10 — seven items, decided).
>
> PL-70: add the `/test-link` sample-landing page and point every SAMPLE_* URL value at it; redirect invalid tokens on `/api/resume-payment` (and sweep the other tokenized GET endpoints) to a friendly restart page instead of raw JSON; make #9's sample block three realistic package buttons matching the real compose; adopt the QA fixture naming rule (distinct parent/student names, rename existing offenders). PL-71: turn the PL-68 sentence helper into the one mode-aware location builder (in-person "in Room 204" / online "online — here's the meeting link: …"), expose it as a composed variable, seed #4 v3 + #5 v4 with it, route LR's {classDetailsBlock} through it (full instructor name stays), make the PL-68 entry preview mode-aware, and add the `{together_or_blank}` parent-only clause + seed LR v3's "To get {you_or_name} in…" sentence with it. PL-72: tokenized W2 decline flow — GET lands on a confirm page, JS-POST one-tap release (scanner-safe), immediate cascade to the next family with a fresh 48h clock, declined (not expired) in the admin panel, interest row kept, and seed the W2 copy from the doc with {declineLink}. PL-73: registration-alert count becomes "1 enrolled / 8 min / 10 cap" — fix the code twin (it's on the wire), reseed the draft + samples. PL-74: escalation-alert button deep-links to the agreement row in /admin/agreements, which gets a one-click "Restart automatic nudges" (re-send + re-arm +3d/+7d), with chase rounds tracked and the round-2 escalation copy per the doc. PL-75: orderSummaryBlock's heading → "Enrollment Summary" (+ match the hardcoded #0 twin's subject to the live "Enrollment Confirmed" one). PL-76: one-click "Convert to 1-on-1 tutoring" on cancelled enrollments — Stripe customer credit balance for the paid amount (mirrored in admin + wizard), a registered CX_TUTORING_START availability-request email reusing the PL-53 tokenized page, then the standard availability→wizard→approval pipeline; idempotent, credit adjustable. Note the editor context at the top: LR v2, #8 v3, WR v3, AG-N v2, and #0-P v4 already carry Scarlett's edits.
>
> Rules: PL-x IDs in commits; `git push` after committing; standing copy rules apply; check items off here when shipped.
