# Portal fixes — batch 24 (READY — handed to Code Jul 30; 9 items, PL-234…242)

Closed and handed off July 30 (9 items). If this doc is extended after you've pulled it, wait for an explicit re-read ask.

**Suggested order:** quick tier (234 T8 location-line conditional · 236 Team access copy · 240 School-contacts overflow · 241 Add-a-new-class opens expanded + collapsed-card audit) → 235 copy edits (SV v2 · T8 v4 · E0 next · T_SCHEDULE_SET v4 — new registry versions via anchor-guard + code twins, exact strings below) → 238 timezone aliases → 239 wizard validation (practice tests DEFAULT 2, editable; plain-English error sweep) → 242 Schools entity (before 237 — the wizard's Branding & Collateral step reads the same school records) → 237 wizard restructure + the two new CS-variant emails (no-collateral welcome w/ warning; collateral-only follow-up).

Next PL after this batch: **PL-243**.

**Decisions (Jul 29–30):** practice tests default 2, editable · collateral skip creates a Needs Attention to-do (skip-for-now) · no-collateral CS needs an explicit confirm · schools = real editable records, contacts are attributes, same-record entry points everywhere.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped · registry template edits ship as new versions with matching code twins (never drift).

---

## PL-234 — T8 location line: only say "tutor sends the meeting link" when there's actually no link (reported Jul 29, Scarlett's review of T8 v3 test render)

The v3 render showed "Sessions happen online — Billy sends the meeting link before each session." even though a default meeting link exists. That fallback sentence should render ONLY when the engagement is online AND no link is available anywhere (engagement location empty and tutor default_meeting_link empty). Otherwise render as before: the actual meeting link. (Composes with the PL-211 no-location machinery — same "nothing anywhere names a location" test.)

**✅ SHIPPED (Jul 30).** Root cause found: the sentence never came from the live composer at all — it was the EDITOR SAMPLE for `{locationBlock}` (so every test render showed it regardless of real data), while the real composer rendered *nothing* in the no-link case. Fixed both sides: (1) the composer now renders the fallback sentence exactly and only in the PL-211 state (engagement location empty AND tutor default empty — the doc's parenthetical definition), with the tutor's real first name; a known link or place renders as itself, unchanged. (2) The editor sample now shows the COMMON case (a real link render, per the samples-from-composers rule), so a test render can never again imply the fallback is the default. `regress:links` green, tsc clean.

## PL-235 — Copy edits from Scarlett's Jul 29 test-render review (SV v1, T8 v3, T_SCHEDULE_SET v3) — exact strings

Each = new registry version (anchor-guard patch) + matching code twin. Verbatim:

**SV_CLASS_SURVEY → v2:**
- "nicely done." → "nicely done!"
- "Rather not be named? There's an anonymous option right on the form." → "(You can even do it anonymously if you want.)"

**T8_WELCOME_HANDOFF → v4:**
- "no need to email us for the small stuff." → "no need to email us for the small stuff if you don't want to."
- "One more thing worth knowing: you have a family portal." → "One more thing: we set up access for your family in the [Higher Ground Learning portal]({portalLink})." (hyperlink on the last 4 words)
- DELETE the sentence: "[Open it any time]({portalLink}) — it's yours for the whole tutoring journey." (the intro sentence now carries the link)

**E0_CONFIRM_PARENT → next version (keep the portal-intro voice in lockstep with T8):**
- "**One more thing worth knowing: you have a family portal.**" → "**One more thing: we set up access for your family in the Higher Ground Learning portal.**"
- Rest of the block unchanged — the "View your registration" button stays the link (no inline hyperlink needed here, and there's no "Open it any time" sentence in #0).

**T_SCHEDULE_SET → v4:**
- "no need to email us for the small stuff." → "no need to email us for the small stuff if you don't want to." (keep in lockstep with T8's folded copy — repeat-path families see this template)

**✅ SHIPPED (Jul 30).** All four published via `scripts/seed-pl235-copy.mjs` (one anchor-guarded script, idempotent — second run confirmed no-op): **SV_CLASS_SURVEY v2** (stays draft/live=false as it was), **T8_WELCOME_HANDOFF v4**, **E0_CONFIRM_PARENT v6**, **T_SCHEDULE_SET v4** — every string verbatim from this doc; T8's portal intro carries the inline link on "Higher Ground Learning portal" and absorbed the deleted "Open it any time" sentence exactly as specified. Matching code twins updated in the same commit (SV + E0 composers in `email.ts`, T8 in `intake-emails.ts`, all-set in `schedule-approval.ts`) and `comms-template-seed.ts` synced for all four. `regress:links` (audits the new bodies, including the bold-with-inline-link markdown) and `regress:pronouns` green.

## PL-236 — Team access panel copy: the tutors-panel sentence no longer matches the access model (found Jul 29, batch-23 verification)

The panel intro still says "Tutors sign in while they're active in the tutors panel (making one inactive ends their login)". Since PL-213/223/226, the login gate is `instructors.active` (edited in Contacts → Instructors), and the tutors panel's retire only ends login for tutor-only people (access-aware, with the dialog explaining). Reword to match, e.g.: "Instructors and tutors sign in while they're active on Contacts → Instructors (deactivating there ends their login; retiring a tutor-only person ends it too, and the retire dialog says which applies); school contacts sign in while their affiliation is open; families always can."

**✅ SHIPPED (Jul 30).** Reworded essentially as suggested: "Instructors and tutors sign in while they're active on Contacts → Instructors (deactivating them there ends their login; retiring a tutor-only person from the tutors panel ends it too — the retire dialog says which applies); school contacts sign in while their affiliation is open; families always can. Nothing here deletes history — access ends, records stay."

## PL-237 — Class wizard: move branding & collateral into its own step (Sessions → **Branding & Collateral** → Review), with Skip / Skip-for-now + no-collateral welcome path (reported Jul 30, screenshots on file)

Scarlett's redesign of the Add-a-New-Class flow:

**A. Remove collateral/branding from where it currently sits:**
- Step 1: the "Collateral branding (used on the generated flyer & parent letter…)" block — school logo upload, accent color, collateral language — comes OUT of step 1.
- Step 2: the "Collateral (flyer & parent letter)" card — short link, collateral language, practice tests, flyer blurb — comes OUT of step 2.
- Live class rosters: the collateral section embedded there is REMOVED entirely (it moves to the places below).

**B. New wizard step between "Sessions" and "Review": Branding & Collateral.**
- Look and functionality = EXACTLY the class-card collateral panel (the 4th screenshot): download buttons hidden/disabled pre-create as appropriate, but the fields verbatim — hgl.co short link, language of generated files, practice tests, flyer intro sentence (with the grey standard default), extra letter paragraph, promo code / savings / deadline trio with the Stripe note, plus the branding bits that left step 1 (logo, accent, language default). Preview ("Show previews") included if feasible pre-create.
- Two skip options: **"Skip"** and **"Skip for now (remind me later)"**. Skip-for-now creates a to-do: a state-driven **Needs Attention row** ("Collateral not set up for {className}", deep-linked per the standing rule) that clears itself when the collateral fields are completed — completed under Classes → Branding & collateral (see D).

**C. The "class is ready" welcome forks on collateral state:**
- If collateral was skipped, offer a **new email variant: CS without the letter + flyer** — same welcome (sales link, deadline, portal intro, conditional sample announcement per PL-225B) but no attachments and no "I've attached the materials" paragraph (adapted copy, new template + code twin). Some schools don't want the docs.
- **Warning before sending the no-collateral variant:** an explicit confirm making sure the sender really wants the welcome to go out without the letter and flyer (plain English: what the school will and won't receive).
- **New follow-up email: collateral-only.** If the no-collateral welcome already went out and the school later wants the materials, a second admin-initiated email delivers + explains the letter and flyer WITHOUT repeating the class-is-ready text (adapted from the current CS attachment paragraph). Available from the collateral card once the fields are completed and a no-collateral CS is on record for that class.

**D. Classes → Branding & collateral tab gains the same panel:** the exact collateral-fields card (4th screenshot) mirrored ABOVE the existing "School branding and collateral defaults" — this is where the skip-for-now to-do deep-links, and the home for creating/finishing collateral outside the wizard.

## PL-238 — Timezone picker: findable by country and major city, not just IANA zone name (reported Jul 30)

Scarlett couldn't find Italy's timezone by typing "Italy" or "Milan" — only "Rome" works (IANA Europe/Rome). Make the picker foolproof: match on country names and major-city aliases (e.g. Italy/Milan/Turin → Europe/Rome; Germany/Munich → Europe/Berlin; China/Shanghai/Beijing → Asia/Shanghai), showing the resolved zone with its current UTC offset so the choice is verifiable. A maintained alias map (country → zone, top cities → zone) is enough — no need for a geocoder. Apply everywhere a timezone is picked (school create/edit, tutor profile, class wizard).

**✅ SHIPPED (Jul 30).** New leaf map `app/utils/timezone-aliases.ts` (~90 zones: countries + major non-IANA cities across the Americas, Europe, Africa & Middle East, Asia-Pacific — maintained by hand, extend as schools appear) + `utcOffsetLabel()` computing the zone's CURRENT offset via Intl. `SearchCombobox` options gained a `keywords` field — searched, never displayed — and `TimezoneSelect` labels every option "{zone} ({UTC±X})" with the aliases as keywords, placeholder updated to say a country or city works. One component, so every picker got it at once (instructor profile, class wizard incl. school create, availability grid). Verified live in the instructor editor: "Italy" and "Milan" → Europe/Rome (UTC+2), "Munich" → Europe/Berlin (UTC+2), "Beijing" → Asia/Shanghai (UTC+8).

## PL-239 — Class wizard validation: show what's required, validate at the step, and speak plain English (reported Jul 30, error screenshot on file)

Three failures in one create flow:
1. **Step 2's Next button greys out with no explanation.** Mark required fields visibly (asterisk/label) and, when Next is disabled, say why ("Next needs: price, capacity" — live list under the button).
2. **Practice tests passed step 2 empty, then blew up at Review** — and the error was raw SQL: "null value in column \"practice_test_count\" of relation \"classes\" violates not-null constraint." Validate each field at its own step (post PL-237 this lives at the Branding & Collateral step). **Decision (Scarlett, Jul 30): practice tests DEFAULTS to 2, editable** — prefilled so the create can never hit the not-null constraint, changeable at the step and later on the collateral card. Review can't be reached in an un-creatable state.
3. **Plain-English error sweep:** no raw DB/constraint text anywhere admin-facing. Every wizard/create error states what's wrong, in whose terms ("The number of practice tests is missing"), and links/jumps to the exact step and field to fix it. Sweep the wizard's other failure paths (and any create/edit forms sharing the pattern) for the same defect class.

**✅ SHIPPED (Jul 30).** (1) One needs-list drives everything: required fields marked with red asterisks (class type, price, capacity, practice tests), and a greyed Next now says why LIVE under the button — "Next needs: class type · price · capacity" — on every step (step 1: "a school — pick one or add it"; step 3: sessions/dates). (2) **Practice tests default to 2** (prefilled on a fresh wizard, prefill wins on copy-a-class), validate at their step (whole number ≥ 0, named in the needs-list if cleared), with a "Defaults to 2 — change it any time here or on the collateral card" note; a belt in the create mapping sends 2 instead of null on any path that skips both, so the not-null constraint is unreachable. (3) Error translation: `explainCreateError()` turns not-null violations into "The {field} is missing — fill it in and create again" with a **"Go to the {step} step to fix it →" jump button** (7 columns mapped to their step; unknown columns still get plain field-name phrasing), foreign-key errors → "re-pick the school or instructor", and the sessions-insert failure states the rollback guarantee plainly ("the class was NOT created — nothing half-made to clean up"); genuinely unknown errors lead with plain English and tuck the technical detail in parentheses at the end. Verified live in the wizard: step-1 and step-2 needs-lines render, practice tests prefilled "2", asterisks present. Note for PL-237: the needs-list mechanism is step-keyed, so the collateral fields' validation moves with them into the new step.

## PL-240 — Classes → School contacts still spills outside its container (reported Jul 30)

Same PL-228 defect class, missed in the sweep: the School contacts section under Classes overflows its card. Fix with the same wrap/min-width-0 treatment and re-check the remaining Classes-tab sections at desktop widths while in there.

**✅ SHIPPED (Jul 30).** The widener was the actions cell's `whitespace-nowrap` (three buttons forced onto one line) — dropped so the actions wrap (PL-228 treatment), plus both affiliation tables gained `overflow-x-auto` wrappers as the belt-and-braces (wide content scrolls inside its card, never past it). Probed ALL four Classes-tab sections at 1280px with a scripted scrollWidth check: School contacts had been 52px past the card; after the fix, zero card-level overflows anywhere on the tab (the only remaining probe hit is a native `<select>`'s internal option width — invisible, not the defect class). Screenshot-verified: table fully inside the card, actions stacked cleanly.

## PL-241 — Classes → "Add a new class" opens collapsed (reported Jul 30)

Same PL-229A rule, missed on this section: selecting "Add a new class" in the Classes sidebar lands on a collapsed card needing a chevron click. Selecting the sidebar item IS the intent — open it expanded and ready. Audit any other sidebar sections still rendering the collapsed-card layer (all tabs), so this class of complaint can't recur section by section.

**✅ SHIPPED (Jul 30).** Full scripted audit of every sidebar section across every tab (parsed each section wrapper's first CollapsibleSection for `defaultOpen`): FOUR were still landing collapsed — **Add a new class** (the reported one), **Branding & collateral**, **QuickBooks**, and **Google Calendar** — all now `defaultOpen` (QuickBooks keeps its deep-link openSignal on top). Everything else already opened ready: rosters, School contacts, Instructors, Phone calls, the Contacts lenses, all five Tutoring sections, the standalone pages' primary cards (agreements Families, campaigns New campaign), and the plain-card sections (Dashboard, Contact settings, Team access) which have no collapse layer at all. Deliberately left collapsed: secondary cards *within* a section (e.g. agreements' Policy versions) — the rule is about landing, not about flattening every card. Verified in the browser: Add a new class lands with the wizard visible, Google Calendar lands with the connection card open.

## PL-242 — "School contacts" becomes **Schools**: a real school record with contacts as an attribute (reported Jul 30)

Schools currently have no editable home outside the Add-a-New-Class flow — e.g. the QA school named "ASF – ASF" (created before the naming rule) cannot be renamed to "American School Foundation – ASF" from anywhere. And the section is named after the people, not the entity.

- Rename the section (Classes tab and Contacts tab where applicable) to **Schools**. Each school is a card/profile: **full name, nickname, slug, timezone, logo, accent color, collateral language defaults** — viewable and editable here, outside the wizard (this is where "ASF – ASF" gets fixed). Branding fields are the same records the wizard's Branding & Collateral step (PL-237) and the Branding & collateral defaults panel read — one source of truth, multiple entry points, per the standing principle.
- **School contacts become an attribute within each school**: listed on the school's card (name, email, affiliation open/closed, digest state), with the existing add/edit/close-affiliation actions. The people-centric view can remain as a lens if it's already built (like Students/Parents → Family profile), but the primary organization is by school.
- Names are doors (PL-230 rule): school names anywhere in the admin (class cards, rosters, reports, counselor rows) link to the school's card.
- Edit-safety notes for Code: nickname/slug feed registration URLs, hgl.co mappings, and collateral text — renaming the display name must be safe; changing nickname/slug should warn about what it propagates to (same spirit as the PL-226 email-edit warning).
