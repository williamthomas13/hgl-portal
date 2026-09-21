# Portal fixes — batch 53 (OPEN — Sep 21, 2026, from Claude's batch-52 verification on prod)

**Standing rules:** all prior, incl. the PL-460 CTA rule. Next PL after this file: PL-492.

**Batch closed Sep 21 — 4 of 4 shipped (PL-488 · 489 · 490 · 491).** Gate run vs the PROD build on :3100: `tsc` · `next build` · `smoke:public` **69** (was 36 — the per-state header/footer audit, the inquiry required-set probes, the month label, the tiles + "more") · `regress:cta-landings` (232) · `regress:canonical-hosts` (49). No migration. The dev server served a stale compiled route once mid-batch (the embed comment) — every final number is from the prod build. QA rows (the smoke's own per-state fixtures) removed by the gate itself.

## PL-488 — Inquiry form: every field required EXCEPT "Anything else we should know?" (Scarlett, Sep 21 — corrects the note Code recorded under PL-482 in `2e801a5`)

Scarlett's final decision: on `/inquire` AND every `/embed/inquire.js` snippet, these are **required** — first name · last name · email · phone (with dial code) · how they prefer to connect · student first name · student last name · student's school · what they'd like help with. **"Anything else we should know?" stays OPTIONAL** (the batch-52 note lists "the message" as required — that is superseded; fix that note when you touch it).
- One rule everywhere: page + embed defaults + API validation (reject a blank required field server-side, so an old cached embed can't slip a partial lead through). Retire the per-page `data-require` switch or make it unable to loosen the set.
- The honest error names every missing field ("Please fill in: …"), works at 375px, and the required marker (*) shows on each required label. The honeypot ("Company") stays hidden and is never "required".
- "Student's school": free text is fine; a parent of a homeschooled/graduated student must be able to type something — don't validate against the schools table.
- Gate: cta-landings + smoke still pass; add a smoke assertion that a POST missing any one required field is rejected and a POST with a blank "anything else" is accepted.

### ✅ SHIPPED (Sep 21) — E2E on the dev server at 375px; the batch-52 PL-482 note is marked SUPERSEDED
- **ONE rule, three places:** `INQUIRE_SPEC` (embed) marks the nine fields `required` and the per-page `data-require` switch is **retired** (the script ignores it — nothing can loosen the set); `/inquire`'s form marks the same nine with `*` and `required` (the "What would you like help with?" field is now the same pick-one list the embed uses, so the two can't drift), and its submit names EVERY missing field before posting (*"Please fill in: First name, Last name, Email, Phone, How you prefer to connect, Student first name, Student last name, Student's school, What you would like help with."* — verified at 375px, overflow 0; a browser's native check would stop at the first); **`/api/inquiry` validates server-side FIRST** — a blank required field is a 400 naming it (`missing[]`), so an old cached embed can never slip a partial lead through. **"Anything else we should know?" stays optional** (blank accepted — asserted). Legacy single-name callers still count for the split pair. The honeypot ("Company") stays hidden and never required (the validation runs before the honeypot check, so the gate can prove the rule with the honeypot set and no row written).
- **"Student's school"** is free text with the hint *"Homeschooled or graduated? Just say so"* — never validated against the schools table.
- **Gate:** `smoke:public` posts to `/api/inquiry` — every required field blank in turn → 400 naming that one field (9 checks); all required + a blank "anything else" → 200; the embed script carries exactly nine `required:true` and no per-page switch. `cta-landings` unchanged (232, ALL PASS).


## PL-489 — The no-upcoming-class card has no shared header/footer and no school logo (verification miss on PL-478 / PL-483)

On prod (`c8d35b3`), `/isd`, `/nido`, `/aisct` (evergreen code, no current class → "No upcoming class at ISD right now…" interest capture) render the bare card: **no `SiteHeader`, no footer, HGL mark only — no school logo**, although all three schools have `logo_url` set. `/sls`, `/classes`, `/team`, `/inquire`, `/compass`, `/partner` are correct. PL-478's ship note says this card got the full header; it didn't reach this render path.
- Give this state the same full header + footer as the other state cards, and the PL-483 lockup (HGL + school logo from tablet up; school only at phone width; monogram tile when no logo).
- Then audit every `ClassStateCard` render path against the PL-478 list with a gate, not by eye: smoke asserts `nav` + `footer` present on one URL per state (open, full, closed, in-progress, cancelled, no-upcoming, unknown code).


### ✅ SHIPPED (Sep 21) — verified on the dev server with the real ISD row (logo set) at 375px and desktop
- **The miss:** the no-upcoming-class state renders through `EvergreenCapture` (the `/{code}` and `/{code}/register` fall-through), a path PL-478/483 never touched — the ship note listed it by intent, not by verification. Now `EvergreenCapture` wears the full `SiteHeader` + `SiteFooter` and the `BrandLockup` (`resolveEvergreen` returns the school's name, logo and accent for it). /isd at 375px: header + footer present, lockup `hgl-x-school` with ONLY the ISD logo visible (the header carries HGL); desktop: HGL mark + ISD logo. A school without a logo gets the HGL-only lockup on desktop and nothing extra on phones (the header has HGL).
- **The audit is a gate now:** `smoke:public` builds one class per public state under its own school (open · full · closed · cancelled · in-progress, plus a second school with no class) and asserts, for each of the seven states — open (the code URL), full, closed, in-progress, cancelled, no-upcoming, unknown code (`/c/{bad}`) — that its marker renders AND `data-testid="site-header"` + `data-testid="site-footer"` are present, plus the lockup on the no-upcoming card. `smoke:public` 36 → 60 checks, ALL PASS.

## PL-490 — /classes "Recent classes" month label truncated (Scarlett, Sep 21 — seen on prod after the backfill: "Februa", "June 2")

`monthYear()` in `app/classes/page.tsx` ended with a stray `.slice(0, 6)` (left over from the old six-item text list) — every recent card's "Month YYYY" was cut to six characters. Remove it; cards read "February 2026". Gate: smoke asserts a recent card's date matches `/^[A-Z][a-z]+ \d{4}$/` (the backfill is on prod — 13 ended classes, 12 new schools with logos — so there is real data behind it).

### ✅ SHIPPED (Sep 21)
The slice is gone; the label carries `data-testid="recent-month"` and `smoke:public` asserts every recent card's date matches `^[A-Z][a-z]+ \d{4}$` (the gate's own closed fixture is a recent card; on prod the 13 backfilled classes are). Verified on the prod build.

## PL-491 — /classes "Recent classes" polish (Scarlett, Sep 21)
1. Overflow line "and N more school(s)" → **"more"**, a REAL link (PL-460): expands the remaining recent classes in place; no-JS fallback `/classes?recent=all`. (13 recent today — SIS is the hidden one.)
2. Logos: the tile was ~34px, so wide wordmarks (ISP, ASM, ULIS, ISM) were unreadable → ~72px tall, up to ~160px wide, `object-contain` with a little padding on all three card states; wide logos take the width, square crests stay square, never crop or stretch; the monogram scales to match; the homepage-embed tiles match. Check 375px + the embed.
3. Smoke: a tile's rendered height ≥ 64px on /classes.

### ✅ SHIPPED (Sep 21) — verified on the prod build at 375px
- **"more"** (`RecentMore`, `data-testid="recent-more"`): the remainder is server-rendered hidden (`#recent-rest`); with JS the link reveals it in place and hides itself; without JS its href `/classes?recent=all` renders the full list. The count rides the label ("more (1)").
- **Tiles** (`SchoolTile`): 72px tall, `max-w-[160px]`, `p-2`, the image `h-full w-auto object-contain` — a wide wordmark takes up to 144px of width, a square crest stays square; the monogram is a 72px square at `text-2xl`. Same on open / in-progress / recent cards and on the homepage embed's recent tiles (72px tall, up to 160px wide). Card titles still fit at 375px; overflow 0.
- **Smoke:** tile rendered height ≥ 64px on /classes at 375px (visible tiles) + no overflow; the "more" link's href, the remainder really hidden until clicked and shown in place (puppeteer: 12 visible → 13), tiles wrap their logo (widths 58–160 on the real data — Leone's tall crest is 58 wide at 72 tall, ISP/ASM/ULIS/ISM's wordmarks take the full 160), and the `?recent=all` fallback (skips honestly with a note when the list is under the cap; prod has 13 → SIS is the one behind "more (1)").
- **Caught by the gate, fixed before shipping:** the remainder was rendered with the `hidden` attribute inside a Tailwind `grid` container — `.grid`'s `display:grid` overrides `[hidden]`, so the "hidden" cards were visible. It is `style="display:none"` now, and the smoke check measures visibility, not the attribute. Also: the tile stretched to 160px in the card's flex column (`self-start` now — it wraps the logo).
