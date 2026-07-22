# Portal fixes — batch 8 (July 2026, follows batch 7)

From Scarlett's continuing test-send review of the class sequence. Two small items, both decided. Continues PL-x numbering.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · contact block on parent surfaces · `git push` after committing · PL-x IDs in commits · check items off here when shipped · copy for live templates lands as new registry versions, not code edits.

**Editor context (already done, not work):** Scarlett's copy edits this session were saved directly as new versions — #2-P v2 (the "get started" paragraph now addresses the parent about the student), #4 v2 and #5 v3 ("all classes will take place **here: {classroom}**" → "…take place **in {classroom}**" — MailerLite-era "here:" dropped). Don't re-seed those.

---

## PL-67 · #6 opening line: instructor first name + tense-aware "taking advantage" phrase ✅

> **Shipped.** `{instructorFirstName}` added (first token of the instructor's name, fallback "the instructor", sample renders "Jordan"), and `{takingAdvantagePhrase}` composes the full clause on audience × class-ended (send date past the last session). All four variants verified exactly as specified, at the variable level AND through the live registry render: "Ana has been taking advantage of their class time with Jordan" / "you have been taking advantage of your class time with Jordan" / "Ana was able to take advantage…" / "you were able to take advantage…". **#6 v2 published** as "I sincerely hope that {takingAdvantagePhrase} to the fullest." — sample data shows the ongoing-parent variant and the variable description documents the ended one for the editor. Code twin aligned; #4 and LR untouched (full name stays, per the introduce-then-first-name rule). Ready for your test-send re-review.

Two fixes to the same line, "I sincerely hope that {you_have_or_name_has} been taking advantage of {your_or_their} class time with {instructorName} to the fullest."

**a. First name only.** Full name reads stiff mid-sentence ("with Jordan Rivera to the fullest"). Scarlett's rule: the **first** email that introduces the instructor (#4's "The instructor will be {instructorName}" and LR's instructor+room sentence) keeps first + last; later mentions use **first name only**. Add `instructorFirstName` to the variable registry (`comms-variables.ts`): first token of `instructorName`, fallback `"the instructor"` — mirror `tutorFirstName`'s existing pattern. Sample: "Jordan".

**b. Tense-aware phrasing.** "has been taking advantage" only makes sense while class time remains — true for online classes that slot the second diagnostic mid-course, false for e.g. two consecutive weekend in-person classes, where #6 lands after the final session (no time between weekends). When the class's last session is already past at send time, it should read "**was able to take advantage**."

- Implement as a composed phrase variable in the `{classLocationPhrase}` mold — suggest `{takingAdvantagePhrase}` — resolving on audience × class-ended (last session end vs. send time):
  - ongoing, parent: "Ana has been taking advantage of their class time with Jordan"
  - ongoing, student: "you have been taking advantage of your class time with Jordan"
  - ended, parent: "Ana was able to take advantage of their class time with Jordan"
  - ended, student: "you were able to take advantage of your class time with Jordan"
- The clause is one variable because the auxiliary verb shifts with both audience and tense — nesting the existing conditionals would get unreadable. Use `{instructorFirstName}` logic inside it.
- Seed **#6 v2** (it's live, so a new registry version): "I sincerely hope that {takingAdvantagePhrase} to the fullest." Sample data = the ongoing-parent variant; document the ended variant in the variable description so the editor shows it.
- No other template changes — #4 and LR stay full-name. Scarlett re-reviews via test-send after ship.

## PL-68 · Live "families will see" preview where the class location is entered ✅

> **Shipped.** `classLocationSentence()` exported from the variable registry as the single source of the #4 v2/#5 v3 sentence ("All classes will take place in {classroom}.") — if the email wording changes again, change it there and both previews follow. Live preview added under **both** entry points and verified in the browser as-you-type: the admin class wizard's Default location field (typed "the library" → *Families will see: "All classes will take place in the library."*) and the counselor classroom-request reply form (typed "Room 204" → *Families will see: "All classes will take place in Room 204."*). Hint only, never blocking; hidden while the field is blank (the blank-state placeholder already explains the fallback behavior). Scarlett's #2-P v2 / #4 v2 / #5 v3 edits untouched — nothing re-seeded.

#4/#5 now say "all classes will take place **in** {classroom}". "in" reads naturally for everything counselors typically supply ("in Room 204", "in the library", "in Ms. Chen's classroom") but breaks for oddballs like a street address. Decision: fix it at **entry**, not render.

- Everywhere the classroom/location value is entered — the admin class create/edit form **and** the counselor classroom-request response flow — show a live preview under the field, updating as they type:

  > Families will see: "All classes will take place in Room 204."

- Purely a hint, never blocking — whoever enters the location sees exactly how the sentence reads and can word the value to fit.
- Use the real render sentence (same source as #4/#5) so the preview can't drift from the emails.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-25.md` (batch 8 — two small items, decided).
>
> PL-67: add `{instructorFirstName}` (first token, fallback "the instructor", sample "Jordan") and a composed `{takingAdvantagePhrase}` variable resolving on audience × whether the class's last session is past at send time (four variants in the doc), then seed #6 v2 as "I sincerely hope that {takingAdvantagePhrase} to the fullest." — #4 and LR keep the full name. PL-68: add a live "Families will see: …" sentence preview under the classroom/location input in both the admin class form and the counselor classroom-request response flow, driven by the same sentence the emails render. Note the editor context at the top: #2-P v2, #4 v2, #5 v3 already carry Scarlett's copy edits — don't re-seed them.
>
> Rules: PL-x IDs in commits; `git push` after committing; standing copy rules apply; check items off here when shipped.
