# Portal fixes — batch 53 (OPEN — Sep 21, 2026, from Claude's batch-52 verification on prod)

**Standing rules:** all prior, incl. the PL-460 CTA rule. Next PL after this file: PL-490.

## PL-488 — Inquiry form: every field required EXCEPT "Anything else we should know?" (Scarlett, Sep 21 — corrects the note Code recorded under PL-482 in `2e801a5`)

Scarlett's final decision: on `/inquire` AND every `/embed/inquire.js` snippet, these are **required** — first name · last name · email · phone (with dial code) · how they prefer to connect · student first name · student last name · student's school · what they'd like help with. **"Anything else we should know?" stays OPTIONAL** (the batch-52 note lists "the message" as required — that is superseded; fix that note when you touch it).
- One rule everywhere: page + embed defaults + API validation (reject a blank required field server-side, so an old cached embed can't slip a partial lead through). Retire the per-page `data-require` switch or make it unable to loosen the set.
- The honest error names every missing field ("Please fill in: …"), works at 375px, and the required marker (*) shows on each required label. The honeypot ("Company") stays hidden and is never "required".
- "Student's school": free text is fine; a parent of a homeschooled/graduated student must be able to type something — don't validate against the schools table.
- Gate: cta-landings + smoke still pass; add a smoke assertion that a POST missing any one required field is rejected and a POST with a blank "anything else" is accepted.

## PL-489 — The no-upcoming-class card has no shared header/footer and no school logo (verification miss on PL-478 / PL-483)

On prod (`c8d35b3`), `/isd`, `/nido`, `/aisct` (evergreen code, no current class → "No upcoming class at ISD right now…" interest capture) render the bare card: **no `SiteHeader`, no footer, HGL mark only — no school logo**, although all three schools have `logo_url` set. `/sls`, `/classes`, `/team`, `/inquire`, `/compass`, `/partner` are correct. PL-478's ship note says this card got the full header; it didn't reach this render path.
- Give this state the same full header + footer as the other state cards, and the PL-483 lockup (HGL + school logo from tablet up; school only at phone width; monogram tile when no logo).
- Then audit every `ClassStateCard` render path against the PL-478 list with a gate, not by eye: smoke asserts `nav` + `footer` present on one URL per state (open, full, closed, in-progress, cancelled, no-upcoming, unknown code).
