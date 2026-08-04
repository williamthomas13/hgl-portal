# Portal fixes — batch 27 (CLOSED Aug 3 — ready to ship)

**Batch closed and handed off Aug 3, 2026.** Two items: PL-270 (FP counselor final-days rewrite, exact copy) and PL-272 (staff Google Workspace SSO — Option B, approved by Scarlett). Note: the flyer-burst rendering bug flaged during batch 26 was already fixed separately — no PL here.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped · registry template edits ship as new versions with matching code twins (never drift) · verify composed blocks via the composer path, not editor samples · inline confirm banners only.

---

## PL-270 — FP counselor final-days push: full body rewrite (reported Aug 3 — exact copy, from the live "3 days left to register for SLS SAT Prep" send)

The counselor reminder email ("{N} days left to register for {className}" — the FP — Final-days push (counselor) template) gets this body, replacing the current one. Dynamic bits stay dynamic: counselor first name, days-left count, spots-open count, class name, registration link, enrolled count, class minimum.

> Hi {counselorFirstName},
>
> Quick heads-up: registration for the {className} class closes soon ({daysLeft} days left), and there are still {spotsOpen} spots open.
>
> This is the window where a nudge from the school makes the difference — parents who've been meaning to register usually just need one reminder, and one from you carries real weight.
>
> Here's the link, ready to forward:
>
> {registrationLink}
>
> Current count: {enrolledCount} students enrolled. The course requires a minimum of {minStudents} students to run. After the minimum is reached, late registrations may still be possible while spots remain.
>
> Thanks for the assist!
> Higher Ground Learning

Notes: Scarlett's draft used {0} and {min} for the last-paragraph counts — map to whatever the real composer variables are (shown above as {enrolledCount}/{minStudents}); same for the other placeholders. "{daysLeft} days" should degrade sensibly at 1 ("1 day left"). New version via anchor-guard + code twin as applicable; verify via composer path.

## PL-272 — Staff sign-in via Google Workspace SSO (Option B — approved by Scarlett Aug 3)

Implement the recommended Option B from the PL-255 feasibility report: Google Workspace SSO for staff roles (admin, manager, tutor). Families and counselors stay magic-link only. Scope per the report: ~1 day of code plus the ~30-minute GCP/Supabase dashboard task — write Scarlett clear step-by-step instructions for her dashboard part and tell her exactly when in the sequence it's needed. Workspace offboarding must terminate portal access (that's the point). Keep the existing "Staff sign-in with password" toggle path coherent with whatever ships (rename/repurpose to "Staff sign-in with Google" as appropriate). Update the sign-in help copy (PL-256 shipped text) if it references how staff sign in.
