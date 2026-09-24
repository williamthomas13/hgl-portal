import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { publicSiteOrigin } from '../../utils/base-url'
import { bySessionStart, effectiveStartDate, formatDateRange, publicTimeCityLabel } from '../../utils/dates'
import { preferredClassPath } from '../../utils/evergreen'
import { usableAccent } from '../../utils/accent'
import { classGroup } from '../../utils/class-groups'
import { planEmbed, type EmbedClass, type EmbedPlan } from '../../utils/embed-order'
import { loadPrioritySchools } from '../../utils/embed-priority'

// PL-385: the Squarespace homepage's class strip, portal-fed. The sqsp page
// pastes ONE code block (checklist 9b) and never touches it again — this
// script serves self-contained markup with inline styles (no sqsp CSS
// clashes, no external stylesheets), composed entirely from the class
// records. No cookies, no beacons into the host page. Cached at the edge
// for 5 minutes. Every link rides publicSiteOrigin() (PL-498: the portal
// host — zero hgl.co here; canonical-hosts asserts it).
//
// PL-506 (Scarlett, Sep 24): the strip OWNS its headline and picks its state
// (Squarespace's own heading above the block is gone — checklist 9b):
//   Upcoming Classes · Upcoming and Current Classes · Upcoming and Recent
//   Classes · Classes Happening Now · Recent Classes
// and orders by Scarlett's rules (priority schools → date → fewest paid →
// newest school; the list is the embed_priority_schools setting). 2–3
// upcoming classes alone → large cards with a Register link; otherwise
// normal tiles, the one upcoming class marked "Open for registration". The
// "See all classes" line is a button in the main site's CTA style
// (measured Sep 24: proxima-nova 17px/500, #00AEEE, 6.8px radius, 20.4px
// padding, ~62px tall); the headline sits in its section-heading scale
// (adonis-web 63px/400, centred, 34px below — clamped for phones).
// The state pick + orderings live in app/utils/embed-order.ts (pure;
// regress:embed-order runs them). ?preview= renders each state from
// SYNTHETIC rows (empty · upcoming4 · upcoming2 · upcoming1-current ·
// current · recent) — never touches data.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Row = EmbedClass & {
  id: string
  slug: string | null
  class_type: string
  delivery_mode: string | null
  default_location: string | null
  timezone: string | null
  display_cities: string | null
  course_key: string | null
  schools: { name: string; nickname?: string | null; city?: string | null; timezone?: string | null; logo_url?: string | null; accent_color?: string | null; evergreen_code?: string | null } | null
  sessions: { session_date: string; start_time?: string | null; end_time?: string | null }[]
  /** resolved links */
  href: string
  registerHref: string
}

const HEADING = 'font-family:adonis-web,\'Source Serif 4\',Georgia,\'Times New Roman\',serif;font-weight:400;font-size:clamp(34px,4.9vw,63px);line-height:1.23;letter-spacing:normal;text-align:center;color:#000;margin:0 0 34px'
const BUTTON = 'display:inline-block;font-family:proxima-nova,Montserrat,Arial,sans-serif;font-weight:500;font-size:17px;letter-spacing:.85px;line-height:21px;color:#fff;background:#00AEEE;border-radius:6.8px;padding:20.4px;text-decoration:none'
const monogram = (n: string) => n.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and|de|del|di|la|le|du)$/i.test(w)).map((w) => w[0].toUpperCase()).slice(0, 3).join('') || 'HGL'

function facts(c: Row, base: string) {
  const school = c.schools
  const timezone = c.timezone ?? school?.timezone ?? 'America/Denver'
  const sessions = [...(c.sessions ?? [])].sort(bySessionStart)
  const firstSession = effectiveStartDate(c.start_date ?? '', sessions) || null
  const lastSession = sessions[sessions.length - 1]?.session_date ?? c.start_date ?? firstSession
  const city = publicTimeCityLabel({ schoolCity: school?.city, displayCities: c.display_cities, location: c.default_location, timezone, hglInPerson: !school && c.delivery_mode !== 'online' })
  const honestCity = (school?.city ?? '').trim() || (c.display_cities ? city : null) || (school ? null : city)
  const online = c.delivery_mode === 'online'
  const label = school ? `${school.name} ${c.class_type}` : String(c.class_type)
  const logo = school?.logo_url || null
  const name = school?.name ?? (online ? 'Live online' : 'Higher Ground Learning')
  const tile = logo
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;height:72px;max-width:160px;background:#fff;border:1px solid #f1f5f9;border-radius:8px;padding:8px;box-sizing:border-box"><img src="${esc(logo)}" alt="${esc(name)} logo" style="height:100%;width:auto;max-width:144px;object-fit:contain"/></span>`
    : school
      ? `<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;height:72px;width:72px;border-radius:8px;background:${esc(usableAccent(school.accent_color))};color:#fff;font-weight:800;font-size:22px;letter-spacing:.04em">${esc(monogram(name))}</span>`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;height:72px;max-width:160px;background:#fff;border:1px solid #f1f5f9;border-radius:8px;padding:8px;box-sizing:border-box"><img src="${esc(`${base}/collateral/hgl-logo-color.png`)}" alt="Higher Ground Learning logo" style="height:100%;width:auto;max-width:144px;object-fit:contain"/></span>`
  return { firstSession, lastSession, city: honestCity, online, label, name, tile }
}

function tileCard(c: Row, base: string, mark: 'upcoming' | null) {
  const f = facts(c, base)
  const first = f.firstSession
  const sub = first ? formatDateRange(first, f.lastSession ?? first) : ''
  const pill = mark === 'upcoming' ? `<span data-embed-pill="open" style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#166534;background:#dcfce7;border-radius:999px;padding:3px 9px;margin-bottom:6px">Open for registration</span>` : ''
  return (
    `<a href="${esc(c.href)}" data-embed-card="tile" style="display:flex;flex-direction:column;align-items:center;gap:8px;text-decoration:none;color:#334155;min-width:120px;max-width:200px;text-align:center">` +
    pill + f.tile +
    `<span style="display:block;font-size:14px;font-weight:700;line-height:1.3">${esc(f.name)}</span>` +
    `<span style="display:block;font-size:12px;color:#64748b;line-height:1.4">${esc(c.class_type)}${f.city ? ` · ${esc(f.city)}` : ''}${sub ? `<br>${esc(sub)}` : ''}</span>` +
    (mark === 'upcoming' ? `<span style="display:inline-block;margin-top:2px;font-size:13px;font-weight:700;color:#00AEEE">Register →</span>` : '') +
    `</a>`
  )
}

function largeCard(c: Row, base: string) {
  const f = facts(c, base)
  return (
    `<div data-embed-card="large" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px 24px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;text-align:center;min-width:0">` +
    f.tile.replace('height:72px;max-width:160px', 'height:108px;max-width:240px').replace('max-width:144px', 'max-width:216px').replace('height:72px;width:72px', 'height:108px;width:108px').replace('font-size:22px', 'font-size:32px') +
    `<span style="display:block;font-size:20px;font-weight:700;line-height:1.3;color:#1e293b">${esc(f.name)}</span>` +
    `<span style="display:block;font-size:15px;color:#475569;line-height:1.5">${esc(c.class_type)}${f.city ? ` · ${esc(f.city)}` : ''}${f.firstSession ? `<br>Starts ${esc(formatDateRange(f.firstSession, f.firstSession))}` : ''}</span>` +
    `<a href="${esc(c.registerHref)}" style="${BUTTON};padding:14px 24px;font-size:16px">Register</a>` +
    `<a href="${esc(c.href)}" style="font-size:13px;color:#00AEEE;text-decoration:none;font-weight:700">More info →</a>` +
    `</div>`
  )
}

function render(plan: EmbedPlan<Row>, base: string): string {
  const h2 = `<h2 data-embed-headline style="${HEADING}">${esc(plan.headline)}</h2>`
  const cta = `<p style="text-align:center;margin:28px 0 0"><a href="${esc(`${base}/classes`)}" data-embed-cta style="${BUTTON}">See all classes</a></p>`
  if (plan.mode === 'empty') {
    // TRUE empty — nothing in the database at all. Never on the real site.
    return h2 + `<p style="font-family:inherit;font-size:15px;color:#475569;margin:0;text-align:center">No class is open for registration right now — <a href="${esc(`${base}/classes`)}" style="color:#00AEEE;font-weight:700">join the interest list</a> and we'll tell you the moment the next one opens.</p>`
  }
  if (plan.mode === 'large') {
    return h2 + `<div data-embed-grid="large" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;max-width:${plan.upcoming.length === 2 ? 720 : 1080}px;margin:0 auto">${plan.upcoming.map((c) => largeCard(c, base)).join('')}</div>` + cta
  }
  const tiles = [...plan.upcoming.map((c) => tileCard(c, base, 'upcoming')), ...plan.others.map((c) => tileCard(c, base, null))]
  return h2 + `<div data-embed-grid="tiles" style="display:flex;flex-wrap:wrap;justify-content:center;gap:28px;align-items:flex-start">${tiles.join('')}</div>` + cta
}

// ---- synthetic preview rows (QA only; never touch data) ----------------------
function synthetic(state: string, today: string): Row[] {
  const d = (n: number) => { const x = new Date(`${today}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const mk = (i: number, o: { name: string; city: string; first: number; close: number; paid?: number; runs?: number }): Row => ({
    id: `preview-${i}`, slug: `preview-${i}`, class_type: 'SAT Prep', status: 'open', school_id: `preview-school-${i}`, course_key: null,
    start_date: d(o.first), registration_close_date: d(o.close), delivery_mode: 'in_person', default_location: null, timezone: 'America/Denver', display_cities: null,
    schools: { name: o.name, nickname: o.name.split(' ')[0], city: o.city, accent_color: ['#0f4c81', '#7a2048', '#2e7d32', '#b26a00', '#4a148c', '#006064'][i % 6] },
    sessions: [0, 7, 14].map((n) => ({ session_date: d(o.first + n) })),
    paidCount: o.paid ?? 3, schoolClassCount: o.runs ?? 1, href: '#preview', registerHref: '#preview-register',
  })
  const up = (n: number) => [mk(1, { name: 'Colegio Nido de Aguilas', city: 'Santiago', first: 21, close: 14 }), mk(2, { name: 'Shanghai American School', city: 'Shanghai', first: 28, close: 21 }), mk(3, { name: 'American School of Madrid', city: 'Madrid', first: 35, close: 30 }), mk(4, { name: 'Munich International School', city: 'Munich', first: 42, close: 35 })].slice(0, n)
  const cur = [mk(5, { name: 'Istituto Leone XIII', city: 'Milan', first: -7, close: -10 }), mk(6, { name: 'St. Louis School', city: 'Milan', first: -3, close: -5 }), mk(7, { name: 'American School Foundation', city: 'Mexico City', first: -10, close: -12 })]
  const rec = [mk(8, { name: 'International School of Dusseldorf', city: 'Düsseldorf', first: -60, close: -70 }), mk(9, { name: 'Stockholm International School', city: 'Stockholm', first: -120, close: -130 }), mk(10, { name: 'American International School of Jeddah', city: 'Jeddah', first: -200, close: -210 }), mk(11, { name: 'Cairo American College', city: 'Cairo', first: -260, close: -270 })]
  switch (state) {
    case 'upcoming4': return [...up(4), ...cur]
    case 'upcoming2': return [...up(2), ...cur]
    case 'upcoming1-current': return [...up(1), ...cur]
    case 'current': return [...cur, ...rec]
    case 'recent': return rec
    default: return []
  }
}

export async function GET(request: Request) {
  const base = publicSiteOrigin()
  const preview = new URL(request.url).searchParams.get('preview')
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  let rows: Row[]
  let priority: string[] = []
  if (preview) {
    rows = synthetic(preview, today)
    priority = ['preview-school-2'] // proves the priority rule in the upcoming previews (SAS first)
  } else {
    const [{ data }, prio] = await Promise.all([
      supabase
        .from('classes')
        .select(
          `id, slug, class_type, status, delivery_mode, default_location, timezone, display_cities,
           registration_close_date, start_date, school_id, course_key,
           schools ( name, nickname, city, timezone, logo_url, accent_color, evergreen_code ),
           sessions ( session_date, start_time, end_time ),
           enrollments ( payment_status )`
        )
        .neq('status', 'cancelled')
        .not('slug', 'is', null),
      loadPrioritySchools(),
    ])
    priority = prio
    const all = ((data as any[]) ?? []).map((c) => ({ ...c, schools: one<any>(c.schools) }))
    const runsBySchool = new Map<string, number>()
    for (const c of all) if (c.school_id) runsBySchool.set(c.school_id, (runsBySchool.get(c.school_id) ?? 0) + 1)
    rows = await Promise.all(
      all.map(async (c) => {
        const path = await preferredClassPath({ id: c.id, slug: c.slug, school_id: c.school_id ?? null, course_key: c.course_key ?? null })
        const codePath = c.schools?.evergreen_code ? `/${c.schools.evergreen_code}` : null
        return {
          ...c,
          paidCount: ((c.enrollments ?? []) as { payment_status: string }[]).filter((e) => ['Paid', 'Completed'].includes(e.payment_status)).length,
          schoolClassCount: c.school_id ? runsBySchool.get(c.school_id) ?? 0 : 0,
          // tiles link to the code page where it resolves to this class, else the permanent link;
          // recent/current tiles for a school link to the school's code (the interest / current page)
          href: `${base}${path}`,
          registerHref: `${base}${path.startsWith('/c/') ? `/register/${c.slug}` : `${path}/register`}`,
          codePath,
        } as Row & { codePath: string | null }
      })
    )
    // A current/recent tile whose class the code no longer serves still opens the school's code page (never a dead card).
    for (const r of rows as (Row & { codePath: string | null })[]) {
      const g = classGroup(r, today)
      if (g !== 'open' && r.codePath) r.href = `${base}${r.codePath}`
    }
  }
  // per-class "today" in its own zone — the same rule /classes uses
  const plan = planEmbed(rows, {
    today,
    priority,
    groupOf: (c) => classGroup(c, new Date().toLocaleDateString('en-CA', { timeZone: c.timezone ?? c.schools?.timezone ?? 'America/Denver' })),
  })
  const inner = render(plan, base)
  const js = `(function(){
  var el = document.getElementById('hgl-upcoming-classes');
  if (!el) return;
  el.innerHTML = ${JSON.stringify(inner)};
})();`
  return new NextResponse(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Edge-cached, refreshed within 5 minutes of a class opening/closing.
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
