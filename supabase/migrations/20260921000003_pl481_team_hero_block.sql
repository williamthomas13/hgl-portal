-- PL-481 (Sep 21 2026): the /team hero photo is an EDITABLE image slot in site
-- content (Settings → Class pages → Team) — Claude uploads the current team
-- photo from the main site with Scarlett through the existing image route
-- (target 'block', key 'team-hero'); no hot-linking to Squarespace's CDN.
insert into public.site_content_blocks (key, section, heading, body_markdown, sort_order)
values ('team-hero', 'team', 'Our team', $md$Where know-how meets dynamism$md$, 1)
on conflict (key) do nothing;
notify pgrst, 'reload schema';
