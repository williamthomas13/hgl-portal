# HGL Portal — Phase 4.5 Spec: Course Collateral Generation

**Version:** 1.0 draft · July 7, 2026 · Companion to hgl-portal-master-spec.md and hgl-phase4-spec.md
**Status:** Decisions resolved (§10) — ready for copy deck, then Code handoff
**Scope:** Auto-generate two collateral pieces per class — a **parent letter** and a **student flyer** — from the class record, in PDF + JPG, delivered to school contacts without them having to ask.

---

## 1. Purpose

Today each new class requires hand-building a flyer (Canva-style poster the school posts physically and on screens) and a parent letter (formal one-pager the school forwards to families). Both are rebuilt from scratch per class and drift out of date when class details change. Phase 4.5 generates both from `classes` + `sessions` + `schools`, regenerates them automatically when details change, and surfaces them in the counselor-facing flow so school contacts always have current collateral plus instructions on how to share it.

Reference examples (committed to repo under `docs/collateral-examples/`): MIS flyer, ASF flyer, AISCT flyer, ASF letter (EN), Nido letter (ES).

## 2. Outputs

Per class, four artifacts:

| Artifact | Formats | Purpose |
|---|---|---|
| Student flyer | PDF + JPG | Physical posting, school display screens, social/newsletter embedding |
| Parent letter | PDF + JPG | Forwarded to families by school contact, printed for backpack mail |

- PDF is print-quality (A4, since most partner schools are international; confirm — see §10).
- JPG is a raster of the same layout at screen-friendly resolution (~1600px long edge) for display screens and easy embedding.
- All four regenerate automatically whenever the underlying class/session/school data changes (same philosophy as the ICS endpoint — collateral is a *view* of the data, never a stored document that goes stale).

## 3. Data model additions

### `schools`
- `logo_url` (text) — school crest/logo, uploaded once via admin (Supabase Storage bucket `school-assets`, public read). Renders top-right on flyer and is omitted gracefully if blank.
- `accent_color` (text, hex) — per-school accent used for the flyer's promo burst and CTA elements (examples: ASF maroon, AISCT gold; default HGL blue when blank).
- `collateral_language` (enum `en | es | both`, default `en`) — default for that school's collateral; overridable per class. Rationale: partner schools are English-speaking international schools, but some parent bodies aren't — a handful of schools request Spanish alongside English. EN/ES only; no reliable copy exists for other languages (Italian, Chinese, etc.), so those schools get EN.

### `classes`
- `short_link` (text) — the hgl.co path for this class (e.g. `hgl.co/asf`). Scarlett already maintains the hgl.co mapping at class creation; this field records it so collateral can print it. Rendered as the "more info, FAQs, and registration" destination.
- `collateral_language` (enum `en | es | both`, nullable) — overrides school default.
- `letter_blurb` (text, nullable) — optional per-class paragraph inserted into the letter (see §5). Plain text with line breaks; no rich editing.
- `flyer_blurb` (text, nullable) — optional override of the flyer's one-sentence partnership intro ("{schoolNickname} has partnered with Higher Ground Learning to offer a {duration} {delivery} {classType} course...").
- `practice_test_count` (int, default 2) — renders "2 full-length tests" bullet / "+ 2 full-length digital practice tests" line.
- Promo fields (display-only; the actual discount lives in Stripe as a promotion code — see §6a): `promo_code` (text), `promo_amount` (numeric), `promo_deadline` (date), all nullable. Promos are fully optional — recent experiments underperformed — so all templates must read naturally with no promo set.

### Computed (never stored)
- `classroomHours` — sum of session durations, rendered "14 hours classroom time".
- `dateRange` — first session date – last session date.
- `dayPattern` — if sessions fall on a consistent weekday pattern, render it ("Tuesdays & Thursdays", "Saturdays & Sundays"); otherwise render "(visit {shortLink} to see class days)" as in the ASF flyer example.
- `classTime` — reuse the Phase 2 computed value; if sessions have split blocks (AISCT: 9:30–11:30 | 12:30–14:30), render both ranges.

## 4. Student flyer template

One template, variable-driven, matching the established design system (examples in repo):

- **Header:** HGL logo top-left on blue wave; school logo top-right (omitted if no `logo_url`).
- **Headline:** "{CLASS_TYPE} COURSE" (e.g. "SAT PREP COURSE") with **QR code** adjacent. QR encodes `/register/{slug}?src=flyer` (registration, not the info page). Small caption beneath the QR: **"Scan to register"** (ES: "Escanea para inscribirte") — required, since the printed short link and the QR now intentionally point at different destinations (info page vs. direct registration).
- **Intro sentence:** default "{schoolNickname} has partnered with Higher Ground Learning to offer a {computed duration, e.g. '4-week' / '2-weekend'} {online | in-person} {classType} prep course {in_person ? 'taught at ' + schoolNickname : ''}." Overridable via `flyer_blurb`.
- **Schedule block:** {dateRange} / {dayPattern} / {classTime}.
- **Burst slot** (accent-colored circle, priority order):
  1. Promo set → "SAVE {promoAmount} — sign up before {promoDeadline} & use code "{promoCode}""
  2. Else `enrollment_deadline` set → "Registration closes {enrollmentDeadline} — save your spot!" (ES: "Inscripciones hasta el {enrollmentDeadline} — ¡aparta tu lugar!")
  3. Else the slot collapses (layout reflows; no filler element).
  When both exist, promo wins the flyer burst; the deadline still appears in the letter summary box (§5), so it's never lost.
- **Bullets** (static copy, delivery-aware): "{In-person | Live online} instruction from expert instructors" · "{practice_test_count} full-length tests" · "Content, strategy, tactics, & timing" · "Comprehensive curriculum".
- **CTA circle** (accent-colored): "Spaces are limited! More info, FAQs, and registration:" + **{shortLink}** in the pill.
- **Hero photo:** the standard student photo (static asset, committed to repo).
- Fix carried from examples: the MIS flyer says "In-person instruction" on an online class — the template's delivery-aware bullet eliminates that class of error.

## 5. Parent letter template

One-page letter on the HGL letterhead (contact strip top, phone/address strip bottom — static assets):

- **Salutation:** "Dear {schoolNickname} Parents:" (ES: "Estimadas familias de {schoolName}:").
- **Body paragraph 1:** why the {examName} matters (admissions + scholarships). Standard copy, EN + ES versions, with the SAT/ACT conditional pattern from email #3.
- **Body paragraph 2:** HGL credibility paragraph ("For nearly 30 years..." — ES version per Nido example). Standard copy.
- **Optional `letter_blurb`:** inserted as its own paragraph after paragraph 2 when present — this is the per-class customization hook (returning-school framing like Nido's "trabajaremos nuevamente", special notes, etc.).
- **Scarcity line:** "Spaces are limited! After the class hits the enrollment cap of {capacity}, students will be added to a waitlist."
- **Class summary box** (light-blue rounded box): "{Month Year} {classType} Class" · delivery + location · {dateRange} · {classTime} · "{classroomHours} hours classroom time + {practice_test_count} full-length practice tests" · enrollment deadline line if `enrollment_deadline` set · promo line if promo set · "more info & registration: **{shortLink}**".
- **Closing paragraph + signature:** William Thomas signature image (static asset) with localized title — EN: "Director, International Programs" · ES: "Rector, Programas Internacionales".
- When `collateral_language = both`, both EN and ES versions of the flyer and letter are generated and surfaced side by side (endpoints take `?lang=en|es`; admin card and counselor view show both sets). Single-language classes show one set.

## 6. Generation & endpoints

- **Rendering:** server-side HTML/CSS templates rendered to PDF (headless Chromium — same infra decision Code makes for any PDF; JPG produced by rasterizing page 1 of the same render). Exact library choice left to the Code session; requirement is pixel-stable output of the committed templates.
- **Endpoints (auth-gated — staff + that school's counselors only, consistent with Phase 4 RLS scoping):**
  - `/api/classes/{id}/collateral/flyer.pdf` · `flyer.jpg`
  - `/api/classes/{id}/collateral/letter.pdf` · `letter.jpg`
  - Optional `?lang=en|es` (defaults to the class's effective language; required distinction only when `both`).
- Always rendered from live data — no caching beyond short CDN TTL, so a date change is reflected on next download. (Contrast with emails: sent emails are immutable; collateral is always-current.)
- QR generation server-side at render time (no external QR service).

### 6a. Promo mechanics (resolved: Stripe promotion codes)

- The discount itself is a **Stripe promotion code** created in the Stripe dashboard (coupon + code, with Stripe-side expiry matching `promo_deadline`).
- Checkout change: enable `allow_promotion_codes: true` on the Checkout session — one line; Stripe handles validation, expiry, and redemption limits.
- The portal's promo fields are **display-only** (they drive collateral copy); there is no portal-side discount math. Keeping them in sync with Stripe is a manual step noted in the admin card ("Create the matching code in Stripe").
- Workflow when running a promo: create code in Stripe → fill the three promo fields on the class → collateral renders the burst → checkout accepts the code.

## 7. Admin UX

- Class view gains a **Collateral** card: four download buttons + preview thumbnails, plus the fields that drive it (`short_link`, language toggle, `letter_blurb`, `flyer_blurb`, promo fields, `practice_test_count`).
- Validation: downloads work with missing optional fields (promo burst / school logo simply omitted), but the card shows a soft warning if `short_link` is blank ("Flyer will print the full registration URL — add the hgl.co link").
- School view gains `logo_url` upload + `accent_color` picker + default language.

## 8. Distribution (the "without asking" part)

- **Counselor view (Phase 4):** each open class the counselor can see gets a "Class materials" section — flyer + letter downloads (both formats) plus a short static how-to-share note: post the flyer on bulletin boards/screens and student newsletters; forward or print the letter for parent communications; both always reflect the latest schedule, so re-download rather than reusing old files.
- **Counselor digest email:** when a class at the counselor's school opens for registration, the digest (or a dedicated "class is open" notice — align with Phase 4 digest spec) includes links to the collateral downloads with the same one-line sharing instructions. Links point at the portal (auth-gated), not attachments — keeps files current and avoids emailing stale PDFs.
- **Regeneration notice:** when a class detail that appears on collateral changes after the class was announced (dates, times, location, promo), the school contact's next digest flags "class materials updated — please replace any posted copies."

## 9. Out of scope

- Full WYSIWYG editing of collateral (blurb fields only).
- Additional collateral types (counselor one-pagers, social media crops) — future.
- Languages beyond EN/ES.
- Automated posting anywhere; distribution is download-based.

## 10. Decisions (resolved July 7, 2026)

1. **Promo mechanics → Stripe promotion codes** (see §6a). Portal promo fields are display-only. Promos are optional and currently deprioritized (recent trials underperformed); all copy reads naturally without one.
2. **Paper size → A4** for all collateral (international school base).
3. **Letterhead → highergroundlearning.com** everywhere for consistency (highergroundprep.com forwards there, but is not printed). SLC address/phone strip retained as in examples.
4. **Languages → EN, ES, or both** per school (class-level override). `both` generates and surfaces both sets; endpoints take `?lang=`. No other languages — no reliable copy beyond EN/ES.
5. **Flyer burst fallback → registration deadline callout.** Priority: promo → enrollment deadline → collapse (§4).
6. **Deadline vs. discount on flyer:** no forced choice — the priority rule handles it. Promo occupies the burst when present; the deadline always appears in the letter summary box regardless.

## 11. Handoff notes for Code session

- Commit the five reference images to `docs/collateral-examples/` and the static assets (HGL logo, letterhead strips, hero photo, signature image) to the repo before the session.
- Build order: schema migration → templates (flyer EN → letter EN → ES variants) → render endpoint → admin Collateral card → counselor surface + digest links.
- EN/ES template copy to be drafted in this project (like the Phase 2 deck) and dropped into the session — **not** improvised by Code. Copy deck to follow as `hgl-phase4.5-collateral-copy.md` once §10 decisions land.
