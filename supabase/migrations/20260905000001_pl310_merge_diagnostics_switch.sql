-- PL-310: merge "Has diagnostics" + "Has Synap" into ONE switch.
-- Scarlett's rationale: a class with diagnostics runs them through Synap or
-- similar — the second switch modeled a distinction that doesn't exist.
-- Every class takes the OR of its two current values, so no class's email
-- behavior changes (both test classes end up exactly as before).
-- The has_synap column itself is dropped by the follow-up migration
-- 20260905000002 AFTER the code that stopped reading it deploys — dropping
-- it here would 500 the still-running old build's select list.
-- Idempotent: safe to run twice.

update classes
  set has_diagnostics = (has_diagnostics or has_synap)
  where has_synap is distinct from false
    and has_diagnostics is distinct from true;

notify pgrst, 'reload schema';
