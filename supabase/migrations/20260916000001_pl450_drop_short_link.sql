-- PL-450 (PL-384 phase 2): classes.short_link drops. Codes live in ONE
-- place (schools/course_meta evergreen_code — Classes → Short links); the
-- collateral printed link composes via preferredClassPath; every reader was
-- converged in the same batch (collateral model, nudge sweep, dashboard row,
-- class-confirmed default, notify-interest, counselor card, wizard, panel).
--
-- APPLY ONLY AFTER the PL-450 code deploy is live (two-phase rule) — the
-- old build still selects the column.
--
-- Before the drop: classes whose skip-for-now stamp still stands but whose
-- short_link marked them legacy-complete (the pre-PL-429 completion proxy —
-- the live case: MIS SAT Prep) get the stamp CLEARED, so the stamp-only
-- condition reproduces today's behavior exactly (no new nag rows appear for
-- classes that never nagged). IDEMPOTENT (the update is a no-op once the
-- column is gone — guarded).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'short_link'
  ) then
    update public.classes
      set collateral_reminder_at = null
      where collateral_reminder_at is not null
        and coalesce(trim(short_link), '') <> '';
    -- The collateral-changed touch trigger watches short_link (it was a
    -- collateral field) — recreate it over the surviving columns first; a
    -- bare DROP would otherwise refuse (2BP01) or CASCADE the trigger away.
    drop trigger if exists classes_touch_collateral on public.classes;
    create trigger classes_touch_collateral
      before update of class_type, delivery_mode, capacity, enrollment_deadline,
        default_location, collateral_language, letter_blurb, letter_blurb_es,
        flyer_blurb, practice_test_count, promo_code, promo_amount, promo_deadline
      on public.classes
      for each row execute function stamp_collateral_changed();
    alter table public.classes drop column short_link;
  end if;
end $$;

notify pgrst, 'reload schema';
