# Portal fixes — batch 46 (ACCUMULATING — opened Aug 31, 2026)

**Standing rules:** all prior (batch 41/42/44 lists).

(Accumulating. Next PL: PL-441.)

## PL-439 — AL_COLLATERAL_NUDGE goes to the class's CREATOR (Scarlett, Aug 31 — copy approved as-is)
Scarlett approved the nudge copy; the recipient should be the person who created the class, not the general admin audience — they skipped the collateral, they get the reminder. Send to the creator's staff email: record `classes.created_by` at wizard completion if it doesn't already exist (drafts already stamp who; carry it through create; backfill existing classes where the draft/audit trail knows, else NULL). Fallbacks honest: creator unknown (imports, legacy, backfill-blind) or no longer active staff → the current admin default recipient (never silently nobody); note in ship notes which classes fell back. The dashboard Needs Attention row stays visible to all admins regardless (the email targets, the row informs). Ramp: the copy is approved — activate AL_COLLATERAL_NUDGE v1 as-is once the recipient logic lands (same byte-for-byte rule as the batch-43 ramp).

## PL-440 — Ramp AL_AVAILABILITY_UPDATED (Scarlett approved the review render, Aug 31)
Activate AL_AVAILABILITY_UPDATED v1 LIVE exactly as reviewed — byte-for-byte vs the review render, zero copy edits, live gate serves the registry body, one spot send → billy@ (batch-43 ramp rules).
