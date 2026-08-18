import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { emailBaseUrl } from '../../utils/base-url'
import {
  bySessionStart,
  effectiveStartDate,
  formatDateRange,
  publicTimeCityLabel,
} from '../../utils/dates'
import { preferredClassPath } from '../../utils/evergreen'

// PL-385: the Squarespace homepage's "Upcoming classes" strip, portal-fed.
// The sqsp page pastes ONE code block (documented in the cutover checklist)
// and never touches it again — this script serves self-contained markup with
// inline styles (no sqsp CSS clashes, no external stylesheets), composed
// entirely from the class records: logo, name, plain-English date range, and
// a one-line blurb (city/campus + delivery + duration — all record facts,
// never hand-typed; there is no exam-date field on the record, so no exam
// date is claimed). "More info" links go to the PERMANENT code URLs (PL-384).
// Open/close reflects automatically; nothing open → a modest interest line
// pointing at /classes — never an empty hole. No cookies, no beacons into
// the host page (PL-350 analytics stay portal-side, counted when families
// arrive). Cached at the edge for 5 minutes.
//
// ?preview=empty renders the none-open state for QA without touching data.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function GET(request: Request) {
  const base = emailBaseUrl()
  const previewEmpty = new URL(request.url).searchParams.get('preview') === 'empty'

  const { data } = previewEmpty
    ? { data: [] as any[] }
    : await supabase
        .from('classes')
        .select(
          `id, slug, class_type, status, delivery_mode, default_location, timezone, display_cities,
           registration_close_date, start_date, school_id, course_key,
           schools ( name, nickname, city, timezone, logo_url ),
           sessions ( session_date, start_time, end_time )`
        )
        .eq('status', 'open')
        .not('slug', 'is', null)

  const cards: string[] = []
  for (const c of ((data as any[]) ?? [])) {
    const school = one<any>(c.schools)
    const timezone = c.timezone ?? school?.timezone ?? 'America/Denver'
    const sessions = [...(c.sessions ?? [])].sort(bySessionStart)
    const firstSession = effectiveStartDate(c.start_date, sessions)
    const lastSession = sessions[sessions.length - 1]?.session_date ?? c.start_date
    const close = String(c.registration_close_date ?? firstSession ?? '').slice(0, 10)
    const todayInZone = new Date().toLocaleDateString('en-CA', { timeZone: timezone })
    if (!close || todayInZone > close) continue // not registerable → not on the strip

    const city = publicTimeCityLabel({
      schoolCity: school?.city,
      displayCities: c.display_cities,
      location: c.default_location,
      timezone,
      hglInPerson: !school && c.delivery_mode !== 'online',
    })
    const online = c.delivery_mode === 'online'
    const weeks = Math.max(
      1,
      Math.round(
        (new Date(lastSession + 'T12:00:00Z').getTime() - new Date(firstSession + 'T12:00:00Z').getTime()) /
          (7 * 86400_000)
      ) + 1
    )
    const blurb = [
      online ? `Live online · ${city}` : `In person · ${city}`,
      `${sessions.length > 0 ? `${sessions.length} sessions over ` : ''}${weeks} week${weeks === 1 ? '' : 's'}`,
    ].join(' · ')
    const label = school ? `${school.name} ${c.class_type} Class` : String(c.class_type)
    const logo = school?.logo_url || `${base}/collateral/hgl-logo-color.png`
    const logoAlt = school ? `${school.name} logo` : 'Higher Ground Learning logo'
    const href = `${base}${await preferredClassPath({ id: c.id, slug: c.slug, school_id: c.school_id ?? null, course_key: c.course_key ?? null })}`

    cards.push(
      `<a href="${esc(href)}" style="display:flex;gap:14px;align-items:center;padding:16px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;text-decoration:none;color:#334155">` +
        `<img src="${esc(logo)}" alt="${esc(logoAlt)}" style="height:44px;width:auto;flex:none;max-width:90px;object-fit:contain"/>` +
        `<span style="display:block;min-width:0">` +
        `<span style="display:block;font-weight:700;line-height:1.3">${esc(label)}</span>` +
        `<span style="display:block;font-size:13px;color:#64748b;margin-top:2px">${esc(formatDateRange(firstSession, lastSession))}</span>` +
        `<span style="display:block;font-size:13px;color:#64748b">${esc(blurb)}</span>` +
        `<span style="display:inline-block;margin-top:6px;font-size:13px;font-weight:700;color:#00AEEE">More info →</span>` +
        `</span></a>`
    )
  }

  const inner =
    cards.length > 0
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">${cards.join('')}</div>`
      : `<p style="font-family:inherit;font-size:15px;color:#475569;margin:0">No class is open for registration right now — ` +
        `<a href="${base}/classes" style="color:#00AEEE;font-weight:700">join the interest list</a> and we'll tell you the moment the next one opens.</p>`

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
