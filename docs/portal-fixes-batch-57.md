# Portal fixes — batch 57 (OPEN — Sep 24, 2026): PL-506 homepage embed — headline states + priority ordering

**Batch closed Sep 24 — PL-506 shipped.** Pre-flight: `NODE_USE_ENV_PROXY=1 node scripts/project-sends.mjs --hours 48` → **0 projected actions**. Gate battery vs the PROD build on :3100: `tsc` · `next build` · `smoke:public` **129** (was 115 — the live-state `<h2>`, the heading + CTA styles by text, large-card mode with Register links, the deleted line, the six `?preview=` states with headline + mode + zero hgl.co, the pill on the one upcoming tile, SAS-first priority in the preview, the test page's heading removal + preview forwarding) · `regress:cta-landings` (232) · `regress:canonical-hosts` (**79**, unchanged; the live embed carries 0 `hgl.co`) · **`regress:embed-order` (21, NEW)** · `regress:client-imports` (0). No migration, no env var, no DNS / Vercel domain touched. **Decisions recorded:** the priority list is the `embed_priority_schools` setting seeded with the six on first read (IDs, not names); the headline uses the site's own `adonis-web` on Squarespace with the serif stand-in elsewhere; the CTA uses `proxima-nova` there with Montserrat elsewhere; a current/recent tile links to the school's code page when the code has moved on (never a dead card). **Departure:** "current" reuses the PL-501 `classGroup()` in-progress rule rather than `classQuietReason` (that function answers "should sweeps stay quiet", not "is this class running now") — same facts, the rule that already names the state. Live on the build during the run: "Classes Happening Now" (four in-progress classes, MIS first by priority). QA fixtures self-cleaned. Rows 19/20 of the host table are unblocked once Vercel reports this Ready.

**Standing rules:** all prior. Next PL after this file: PL-507. Cutover state: hgl.co is on Vercel (row 8 DONE Sep 24); rows 19/20 are WAITING ON THIS PL — Scarlett pastes the embed into Squarespace once it ships. **Do not touch DNS / Vercel domains / env.** Pre-flight before any prod data change: `NODE_USE_ENV_PROXY=1 node scripts/project-sends.mjs --hours 48`.

## PL-506 — `/embed/upcoming-classes.js`: the strip owns its headline, picks its state, and orders by Scarlett's rules (Scarlett, Sep 24)

**Why:** the homepage strip is the one piece of the marketing site that reflects the portal live. Today it only knows "something open" vs "nothing open" and the headline lives in Squarespace, so it can't say what it's showing. This makes the embed self-describing and applies the ordering Billy would use by hand.

### 1. The embed renders its own headline
The strip's first element is an `<h2>` rendered by the script (Squarespace's own heading above the block is removed at row 19 — say so in the checklist step 9b and on `public/sqsp-embed-test.html`). Style it to sit in the main site's Pontano/heading scale (measure the current homepage h2 via DOM as batch 54 did; do not guess). Headline by state:

| Upcoming (open for registration) | In progress now | Result |
|---|---|---|
| ≥ 2 | any | **Upcoming Classes** — show upcoming only (see sizes) |
| 1 | ≥ 1 | **Upcoming and Current Classes** — the 1 upcoming first, then current classes by rule 3 |
| 1 | 0 | **Upcoming and Recent Classes** — the 1 upcoming first, then ended classes by rule 3 |
| 0 | ≥ 1 | **Classes Happening Now** — in-progress classes by rule 3 |
| 0 | 0 | **Recent Classes** — ended classes, most recent first (rule 3) |

"Upcoming" = status `open` (registration open). "Current" = in progress (started, not ended, per the serving function's state — reuse `classQuietReason` / the PL-497 public serving function's notion of in-progress; no new state logic). Records-only and backfilled classes count for current/recent exactly as PL-479 counted them.

### 2. Ordering for UPCOMING classes (cap 4)
Applied in order; each rule only breaks ties left by the previous one:
1. **Priority schools first**, in this order, when they have an open class: Nido de Aguilas (`Nido`), International American School of Cape Town (`AISCT`), Shanghai American School (`SAS`), American School of Madrid (`ASM`), Munich International School (`MIS`), International School of Düsseldorf (`ISD`). **DECISION for Scarlett (default = yes):** store this as an admin setting `embed_priority_schools` (ordered list of school ids, edited in Settings → Site content) seeded with these six, rather than hardcoding — Billy will want to change it per season. Match by school id, not nickname text.
2. Soonest **start date** first.
3. **Fewest paid students** first (paid enrollments — the class that most needs filling).
4. **Newest school** first = fewest classes ever run at that school (0 beats 1 beats 2+).

### 3. Ordering for CURRENT and RECENT classes (cap 4, or 3 when one upcoming class precedes them)
Priority schools first (same list), then **most recent start date** first, then fewest classes ever run at the school. Recent = ended classes only (cancelled never appear).

### 4. Sizes and copy
- 4 cards: the current tile size. **2–3 upcoming** (state row 1 with 2 or 3): show just those, with **larger cards** (roughly 1.5× tile, logo + school + city + start date + a "Register" link to `/{code}/register`). 1 upcoming + others: 4 normal-size tiles, the upcoming one first and visually marked ("Open for registration" pill).
- **Delete** the line "No class is open for registration right now — recent classes:" (the headline now carries the meaning). The interest-list sentence only remains for the true-empty case (no classes at all in the database) — never on the real site.
- **"See all classes →" becomes a button** styled like the main site's CTA (batch 54 measured it: 194×61, `#00AEEE`, white text, Pontano) — measure again via DOM, don't reuse numbers blindly. Same link, `${base}/classes`.
- Each tile links to `/{code}` as today; upcoming tiles' Register link → `/{code}/register`. All links on `publicSiteOrigin()`.

### 5. Preview page + QA states
`public/sqsp-embed-test.html`: remove its own `<h2>` and the "Other homepage content continues below…" paragraph (the embed now renders the heading). Keep `?preview=` for QA and extend it: `?preview=empty` (existing) · `?preview=upcoming4` · `?preview=upcoming2` · `?preview=upcoming1-current` · `?preview=current` · `?preview=recent` — each renders that state from synthetic rows (never touches data), so Scarlett can eyeball every headline/size combination on `https://portal.highergroundlearning.com/sqsp-embed-test.html?preview=…` before and after the Squarespace paste. Edge cache stays at 5 minutes.

### ✅ SHIPPED (Sep 24) — one commit; gate battery in the close line

- **1. Headline:** the script renders `<h2 data-embed-headline>` first. Measured on the homepage by DOM at 1280 (headless, Sep 24): section headings are **adonis-web 63px, weight 400, centred, 34px margin-below, line-height 1.23**; the strip's own school names there are a 26px h2. Ours: `font-family: adonis-web, 'Source Serif 4', Georgia, serif; font-weight: 400; font-size: clamp(34px, 4.9vw, 63px); line-height: 1.23; text-align: center; margin: 0 0 34px` — adonis-web resolves on Squarespace (the font is theirs), the serif stand-in elsewhere. The five headlines follow the table exactly; the state pick is `planEmbed()` in `app/utils/embed-order.ts` (pure), "current" = the PL-501 `classGroup()` in-progress rule (first session on or before today, last still ahead), "recent" = ended — no new state logic; cancelled never enters (the query excludes it).
- **2/3. Orderings:** `orderUpcoming()` = priority list → soonest start → fewest paid (Paid/Completed) → fewest classes ever run at the school (non-cancelled, counted from the same query); `orderCurrentOrRecent()` = priority list → most recent start → fewest classes ever run. Caps 4 / 3-after-one. **Decision recorded (Scarlett's default = yes):** the list is the admin setting `embed_priority_schools` (JSON array of school IDs, matched by ID), **seeded once with the six in the doc's order** the first time it is read (`loadPrioritySchools()` resolves Nido · AISCT · SAS · ASM · MIS · ISD by nickname at seed time only), editable under **Settings → Site content → "Homepage strip: priority schools"** (move / remove / add; admin only; the strip picks it up within the 5-minute cache).
- **4. Sizes + copy:** 2–3 upcoming alone → `data-embed-grid="large"` cards (108px logo tile, 20px name, city + "Starts {date}", a **Register** button to `/{code}/register` — or `/register/{slug}` when no code resolves — plus "More info →"); otherwise normal 72px tiles, the single upcoming one first with the green **"Open for registration"** pill + "Register →". The "No class is open… recent classes:" line is deleted; the interest-list sentence survives only for the true-empty database (`mode: 'empty'`). **"See all classes" is a button** measured on the homepage: proxima-nova 17px / 500, letter-spacing .85px, #00AEEE, 6.8px radius, 20.4px padding (~62px tall; the site's own reads 194×62 with its text). Every link rides `publicSiteOrigin()`; a current/recent tile whose class the code has moved on from links to the school's code page (never a dead card).
- **5. Preview page:** `public/sqsp-embed-test.html` — its own `<h2>` and the "Other homepage content…" paragraph are gone; a tiny inline loader forwards `?preview=` on the PAGE to the script; QA links for every state. `?preview=empty · upcoming4 · upcoming2 · upcoming1-current · current · recent` render from synthetic rows (six invented schools, SAS given priority so the rule is visible) — never data. Edge cache unchanged (`s-maxage=300`).
- **Docs:** checklist step 9b + host-table row 19 say the Squarespace block carries NO heading of its own and list the preview URLs.

### Gate
`regress:embed-order` (new, pure module `app/utils/embed-order.ts` holding the state pick + both orderings): seeds covering every row of the headline table, priority list precedence over date, date over fewest-paid, fewest-paid over newest-school, cap 4 / cap 3-after-1, cancelled excluded, 2–3 large-card mode. Plus `smoke:public` asserting the embed's `<h2>` text for the live state and that the CTA renders as a button. `canonical-hosts` stays 79 (the embed must still carry zero hgl.co).
