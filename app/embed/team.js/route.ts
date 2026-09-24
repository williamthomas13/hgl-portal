import { NextResponse } from 'next/server'
import { publicSiteOrigin } from '../../utils/base-url'
import { imageAttrs, parseClassPageImage } from '../../utils/class-page-images'
import { selectTeam } from '../../utils/embed-team'
import { loadTeamRows, loadTeamSetting } from '../../utils/embed-team-setting'

// PL-507 (Scarlett, Sep 24): the homepage's "Meet our team" section, fed by
// the portal — the same instructor rows /team renders (show_on_team,
// public_name, the credential line: a title for leadership, subjects for
// tutors), chosen and ordered by the embed_team_members setting (Settings →
// Site content; the leadership four by default). Same pattern as
// upcoming-classes.js: one paste-once snippet (checklist 9c), inline styles
// only, the strip owns its headline, a CTA button to /team, 5-minute edge
// cache, every link on publicSiteOrigin() (zero hgl.co).
//
// Measured on the homepage by DOM at 1280 (Sep 24): "Meet our team" =
// adonis-web 63px/400 centred; portraits 81×82 images in a 50%-radius
// wrapper (object-fit cover) on a 203px column pitch (163px tile + 40px
// gap); the name an adonis-web 26px/400 h2 13px under the circle; the role
// 17px Pontano Sans; "See more" = the site's CTA (proxima-nova 17px/500,
// #00AEEE, 6.8px radius, 20.4px padding, 62px tall) → /team.
// ?preview=team-empty renders the nobody-chosen state (headline + button,
// never a hole) without touching data.

export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const HEADING = 'font-family:adonis-web,\'Source Serif 4\',Georgia,\'Times New Roman\',serif;font-weight:400;font-size:clamp(34px,4.9vw,63px);line-height:1.23;letter-spacing:normal;text-align:center;color:#000;margin:0 0 34px'
const BUTTON = 'display:inline-block;font-family:proxima-nova,Montserrat,Arial,sans-serif;font-weight:500;font-size:17px;letter-spacing:.85px;line-height:21px;color:#fff;background:#00AEEE;border-radius:6.8px;padding:20.4px;text-decoration:none'
const NAME = 'display:block;font-family:adonis-web,\'Source Serif 4\',Georgia,serif;font-weight:400;font-size:26px;line-height:1.23;color:#000;margin:13px 0 0'
const ROLE = 'display:block;font-family:\'Pontano Sans\',Arial,sans-serif;font-weight:400;font-size:17px;line-height:1.8;color:#000;margin:4px 0 0'

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase()
}

export async function GET(request: Request) {
  const base = publicSiteOrigin()
  const preview = new URL(request.url).searchParams.get('preview')
  const rows = preview === 'team-empty' ? [] : await loadTeamRows()
  const setting = preview === 'team-empty' ? [] : await loadTeamSetting(rows)
  const people = selectTeam(setting, rows)

  const tiles = people.map((p) => {
    const shot = parseClassPageImage(p.headshot)
    const circle = shot
      ? `<span style="display:inline-flex;width:82px;height:82px;border-radius:50%;overflow:hidden;background:#f1f5f9"><img src="${esc(imageAttrs(shot).src)}" alt="${esc(`Portrait of ${p.name}`)}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy" decoding="async"/></span>`
      : `<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:82px;height:82px;border-radius:50%;background:rgba(80,97,113,.12);color:#506171;font-weight:700;font-size:26px;font-family:'Pontano Sans',Arial,sans-serif">${esc(initials(p.name))}</span>`
    return (
      `<div data-embed-member style="display:flex;flex-direction:column;align-items:center;text-align:center;width:163px;max-width:45%;flex:0 0 auto">` +
      circle +
      `<h2 style="${NAME}">${esc(p.name)}</h2>` +
      (p.credential ? `<span style="${ROLE}">${esc(p.credential)}</span>` : '') +
      `</div>`
    )
  })
  const inner =
    `<h2 data-embed-headline style="${HEADING}">Meet our team</h2>` +
    (tiles.length ? `<div data-embed-grid="team" style="display:flex;flex-wrap:wrap;justify-content:center;gap:40px;row-gap:56px;max-width:1178px;margin:0 auto">${tiles.join('')}</div>` : '') +
    `<p style="text-align:center;margin:${tiles.length ? 48 : 0}px 0 0"><a href="${esc(`${base}/team`)}" data-embed-cta style="${BUTTON}">Meet the team</a></p>`

  const js = `(function(){
  var el = document.getElementById('hgl-team');
  if (!el) return;
  el.innerHTML = ${JSON.stringify(inner)};
})();`
  return new NextResponse(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Edge-cached, refreshed within 5 minutes of a profile / setting change.
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
