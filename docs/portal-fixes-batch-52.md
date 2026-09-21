# Portal fixes — batch 52 (CLOSED for hand-off Sep 21, 2026 — Scarlett's public-page walkthrough, 10 items, PL-478…487)

**Standing rules:** all prior, incl. the PL-460 CTA rule.

(Opened + closed Sep 21, 2026 while Code was still finishing batch 51. Next PL: PL-488. **This file is UNTRACKED — Claude did not commit because Code's tree was dirty; Code: commit it as-is as your first step, before any edits.**)

**ORDER: finish + close batch 51 FIRST (the DNS flip waits on PL-471 / 470 / 472 / 474).** Then this batch. Several items here touch surfaces batch 51 just built — PL-470's in-progress page, PL-472's copy, PL-473/477's embeds: apply these changes ON TOP of them, don't fork. Within this batch: PL-485 + PL-480 + PL-482 (small copy/state fixes) → PL-484 → PL-479 → PL-483 → PL-481 → PL-478 (largest). Scarlett's walkthrough verdict otherwise: /login fine, pipeline fine, pages look good.

**Timecard stop-gap RETIRED Sep 21 (evening):** batch 51 verified by Claude on prod — `project-sends.mjs` shows 0 projected actions for the next 30 days with all four records-only classes named quiet — so Claude REMOVED the six pre-claimed `t5_timecard` rows (Gwen / Kevin / Rebecca × 2026-09-16, 2026-10-01; snapshot in `scripts/.tmp-removed-t5-preclaims-2026-09-21.json`). Tutoring can be tested with any tutor; timecard emails behave normally.

## PL-478 — Public pages get the main site's header + footer, so nobody is stranded (Scarlett, walkthrough Sep 21)
"Should there be a top menu that mimics the main site so that they're not stranded?" Yes. Every PUBLIC portal page (`/classes`, `/{code}`, `/c/{slug}`, `/{code}/register` + the register flow, `/team` + bios, `/inquire`, `/partner`, `/compass`, the closed / in-progress / no-upcoming-class states, waitlist/survey/unsubscribe public pages) renders a shared site header and footer that mirror highergroundlearning.com:
- **Header:** HGL logo → `https://www.highergroundlearning.com`; nav in the main site's order and wording — Buy 1-on-1 tutoring hours (/1on1) · Academic Support · SAT · ACT · AP/IB · University Applications · GRE/GMAT · **Classes** (→ the portal's /classes, marked current when on a class page) · About · **Team** (→ portal /team) · Pricing · Contact; right side: "Free Consultation" button (→ portal /inquire once PL-473 lands; main-site /get-started until then) and a small "Sign in". Mobile: the same items in a hamburger sheet. Links to main-site pages are plain same-tab links.
- **Footer:** the main site's footer links (About, Team, Pricing, FAQs, Contact, Privacy Policy, Terms), WhatsApp + phone + email from the existing contact settings, © line. The College Prep Compass signup joins it when PL-477 ships.
- **ONE source of truth:** nav items live in a small editable list under Settings (label, URL, order, show/hide) seeded with the above — Scarlett changes the main site's menu a few times a year and must be able to mirror it without Code. NOT on signed-in surfaces (family portal, instructor/counselor views, admin) and NOT on the checkout-focus steps where a distraction-free header is deliberate (register step 2+ keeps logo-only + "Back to class"): say which pages got which variant.
- Embeds (`/embed/*`) never render it. Works at 375px; no layout shift; the mural hero keeps its measured contrast (PL-453).
- **Same tab vs new tab (Scarlett asked):** the portal cannot control how a Squarespace link opens — that's the "Open in new tab" toggle on each Squarespace link/button, set when the buttons are repointed (DNS runbook step 7). Recommendation recorded: keep SAME TAB (phones handle new tabs badly; back button keeps working) — the shared header is what prevents stranding. Links FROM the portal to the main site are same-tab too.

## PL-479 — /classes: new intro line, school cards with logos, "Talk to us" (Scarlett, walkthrough Sep 21)
- **Intro line** under the "Classes" heading → **"Live test-prep classes at partner schools around the world, online, and at our HQ in Salt Lake City, USA."**
- **Cards, not a text list** — like the Squarespace store grid: one card per class with the SCHOOL LOGO (schools.logo_url; graceful monogram tile in the school's accent color when a logo is missing — never a broken image), school name, class type, city, and a status line. Open classes first (dates, "Registration open — closes {date}", seats-left only when ≤ the existing threshold, button "View class"); then **In progress** (PL-470 state: "Under way — registration closed"); then **Recent classes** (ended, not cancelled: "Milan · June 2026") — each card links to its `/{code}` page. Responsive grid (1 col at 375px, 2–3 on desktop), logos contained on a white tile so mixed aspect ratios look deliberate.
- **Button** "Not sure which class fits? Talk to us" → **"Talk to us"** (→ /inquire with `source=classes`).
- PL-476's backfill JSON gains an optional `logo` per school (a file path Claude supplies; uploaded through the same storage path as the school-logo route) so the 12 backfilled schools arrive with logos; schools without one get the monogram tile.
- The homepage embed (`upcoming-classes.js`) keeps its compact strip — but when NO class is open it may show up to 4 recent-class logo tiles + "See all classes →" instead of only the interest-list line (Scarlett: "it's a better look to show past schools compared to emptiness"). **APPROVED by Scarlett Sep 21 — build it.**
- JSON-LD / sitemap unchanged in meaning; update `smoke:public` for the card markup.

## PL-480 — Register-page states: "View our upcoming classes" + a FULL class reads differently from a CLOSED one (Scarlett, walkthrough Sep 21)
- Closed state (`registration-form.tsx` ~437): "Upcoming classes are listed on our main site." → **"View our upcoming classes."** linking to `/classes` (the portal's page, PL-479) — never the main site.
- **State matrix — write it down in the ship note and make each state's copy deliberate:** ① open ② **full, deadline not passed** ③ **full, deadline passed ≤ 7 days ago** ④ closed (not full) ⑤ in progress (PL-470) ⑥ ended ⑦ cancelled. For ② and ③ the page must NOT read like "you missed it": use HGL's long-standing wording — **"When a class is full, we'll try to teach an additional section. Leave us your email and we'll notify you if we're able to open up a place for you!"** — above the existing waitlist join (②) or the interest capture (③, where the waitlist no longer accepts joins — say what the waitlist API does after the deadline today). Scarlett believes a similar sentence already exists elsewhere in the portal: find every "class is full" / waitlist message (register page, class page, /classes card, W-series emails, closed card) and converge them on ONE wording source; list the sites.
- Staff side: a join in ②/③ shows on the roster's waitlist as today; the "additional section" decision stays a human one (no automation).

## PL-481 — /team (Scarlett, walkthrough Sep 21)
- Hero uses the SAME current team photo as highergroundlearning.com/team — an editable image slot in site content (Claude uploads the file from the main site with Scarlett; no hot-linking to Squarespace's CDN). Keep measured text contrast over it (PL-453 method) or place the heading beside/below the photo.
- Visible tagline: keep "Where know-how meets dynamism", REMOVE " — the instructors and staff behind Higher Ground Learning." from the page. KEEP that sentence in the `<meta name="description">` / OpenGraph / JSON-LD (that is what search engines and AI assistants read — removing it from the visible page costs nothing there).
- Button "Work with us — free consultation" → **"Schedule a free consultation"** ("work with us" reads as a job ad). → `/inquire?source=team`.
- (Careers + new-hire paperwork is filed separately for after Phase 8 — `claude/hgl-hiring-onboarding-roadmap.md`. Do not build here.)

## PL-482 — /inquire polish (Scarlett, walkthrough Sep 21)
- **Split names:** "Your name" → First name* + Last name*; "Student's name" → Student first name + Student last name (optional). Stored in separate columns on the lead (migrate the existing single-name columns additively; keep a derived display name), carried into the family/student on conversion without any splitting logic (PL-466: both surnames live in the last-name field). Same fields in the PL-473 embed.
- Intro copy → **"Tell us a little about what you're looking for and we'll usually be able to reach out the same day. We'll get the rest of the details later when we connect!"**
- Success message bug: "Got it — thank you!We'll be in touch soon" → missing space/line break after "thank you!". Check the embed + every other success card for the same concatenation.
- **Staff alert sentence** gains the contact preference: "Billy Thomas (email, phone) asked about SAT Prep for Desmond **and wants us to get in touch via {WhatsApp | phone call | text | email}**." — omitted cleanly when they didn't pick one. Same fact on the Prospective Students card, first line.
- Confirmed, no change needed: the "Rather just talk to a person?" line reads the contact name/email/phone from the portal's contact settings (`loadContactInfo`) — not hard-coded.

## PL-483 — Co-branding on school class pages: HGL + the school (Scarlett, walkthrough Sep 21)
Class/code pages and their state cards show the school's logo; when a school has none, the HGL logo is substituted (seen on Leone XIII). Scarlett will upload logos for Leone and the new schools — AND wants the HGL logo on these pages always, alongside the school's: a deliberate lockup — HGL mark · thin divider (or "×") · school logo, equal optical height, on the card header and the class-page hero, collapsing to HGL-only when the school has no logo (never two HGL logos). With PL-478's header carrying the HGL logo too, make sure the page doesn't show it three times at 375px — pick ONE of header/lockup per viewport and say which.

## PL-484 — Interest list: a name, a confirmation email, and the Compass opt-in (Scarlett, walkthrough Sep 21)
- **Fields:** Email* · Your first name* · Your last name · Student's first name (optional) — so the first message HGL ever sends them can be personal. (`class_interest` already has `parent_name` + `student_name`; split per PL-482.) Keep it one compact row group; still usable one-handed at 375px.
- **Confirmation email `CI_INTEREST_CONFIRM`** (registry template, transactional, from info@, DRAFT for the usual review → ramp). **Copy APPROVED by Scarlett Sep 21** (she cut "One click, no questions." from the P.S.):
  - Subject: `You're on the list for the next {schoolNickname} {classType} class`
  - Preheader: `We'll email you the moment registration opens`
  - Body:
    ```
    Hi {parentFirstName},

    Thanks for your interest — you're on the list. As soon as registration opens for the next {classType} class at {schoolName}, we'll email you at this address so {studentFirstNameOrYourStudent} can grab a spot before it fills.

    In the meantime, if you'd like a head start, 1-on-1 tutoring is available any time:

    [button:Schedule a free consultation]({inquireLink})

    {contactBlock}

    P.S. Signed up by mistake? [Take me off this list]({interestUnsubscribeLink}).
    ```
  - Generic (no-school) variant: "…the next {classType} class…" without the school. One email per address per school per 30 days (dedupe), never to a suppressed address.
- When a class for that school OPENS, the existing "tell me when a class opens" notification (`notified_at`) must actually exist and send — verify it does; if it doesn't, that is the other half of this item (DRAFT copy, Scarlett reviews).
- **College Prep Compass opt-in** on the interest form AND on the register page's full/closed states (PL-480 ②③④): one UNCHECKED checkbox — "Also send me the College Prep Compass — free test-prep and college-admissions tips by email." Checked → subscribes through PL-477's Compass path (same consent record, same welcome). Never pre-checked; interest-list and Compass stay separately unsubscribable. Depends on PL-477 — ship dark behind it if needed.
- Staff: interest sign-ups visible per school (count on the school card + list), exportable; they are NOT leads unless the person also inquires.

## PL-485 — CTA wording pass (Scarlett, walkthrough Sep 21)
"Talk to us — free consultation" → **"Schedule a free consultation"** everywhere it appears on public pages (class closed / in-progress / no-upcoming cards, class page footer CTA, /team) — EXCEPT the /classes page button, which Scarlett set to **"Talk to us"** (PL-479). One shared constant; list the sites changed.

## Addendum after the batch-51 verification (Claude, Sep 21 evening)
- **Numbering:** the batch-51 close proposes a timecard `void` status "as a PL-478 candidate" — PL-478 is taken (public header). It is **PL-486** below.
- **PL-486 — Timecards can be voided.** No void/delete transition exists, so the three Sep 1–15 class-hours cards (Gwen 6h, Kevin 7.25h, Rebecca 6h) + Billy's 6h MIS-placeholder card sit `open` forever and would read as payable hours in any payroll view. Add `void` (admin-only, reason required, excluded from totals/exports/approval queues, never re-created or re-announced by the sweep, visible in history) and void those four with reason "records-only class — paid outside the portal".
- **PL-487 — Scripts tolerate a failed temp-dir cleanup.** `project-sends.mjs`, `import-class-registrations.mjs` (and any sibling using `rmSync` on a `.tmp-*` build dir) crash with EPERM at the END of an otherwise successful run inside Claude's sandboxed shell (it cannot delete files). Wrap the cleanup in try/catch + a one-line warning, and build into a fresh `mkdtemp` dir each run instead of `rmSync`-ing a fixed path at the start (that start-of-run delete is what blocked the importer outright). Exit code must reflect the real work, not the cleanup.
- **For Scarlett (not Code):** review-send the two new drafts `IQ_INQUIRY_ACK` + `PT_PARTNER_ACK`; supply the Compass welcome content; decide required fields per inquiry embed; eight stale MIS session events remain on Billy's Google calendar (hand sweep); the International Classes calendar stays ungated (it is unconfigured — no veto needed until someone sets `intl_classes_calendar_id`).

