import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import { emailBaseUrl } from '../utils/base-url'
import { publicTimeCityLabel } from '../utils/dates'

// PL-359 D: /llms.txt — the plain-text front door for LLM crawlers and
// assistants. GENERATED from the same records the pages render (schools,
// live classes), so it can never drift: it regenerates on every request.
// The frame prose is deliberately durable; every changeable fact links to
// its authoritative page instead of being restated.

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export async function GET() {
  const base = emailBaseUrl()
  const today = new Date().toISOString().slice(0, 10)
  const [{ data: classes }, { data: schools }] = await Promise.all([
    supabase
      .from('classes')
      .select(
        'id, slug, class_type, status, is_follow_on, start_date, registration_close_date, timezone, display_cities, default_location, schools ( name, city, timezone ), sessions ( session_date )'
      )
      .eq('status', 'open')
      .not('slug', 'is', null),
    supabase.from('schools').select('name, city').order('name'),
  ])

  // PL-353/355 rule holds here too: follow-up classes speak their FEEDER
  // schools' cities, never a zone city.
  const followUpIds = (((classes as any[]) ?? [])).filter((c) => c.is_follow_on).map((c) => c.id)
  const feederCitiesByClass = new Map<string, string[]>()
  if (followUpIds.length > 0) {
    const { data: feeders } = await supabase
      .from('classes')
      .select('follow_on_class_id, schools ( city, nickname, timezone )')
      .in('follow_on_class_id', followUpIds)
    for (const f of ((feeders as any[]) ?? [])) {
      const s = one<any>(f.schools)
      if (!s) continue
      const city = publicTimeCityLabel({ schoolCity: s.city, timezone: s.timezone ?? 'America/Denver' })
      const list = feederCitiesByClass.get(f.follow_on_class_id) ?? []
      if (!list.includes(city)) list.push(city)
      feederCitiesByClass.set(f.follow_on_class_id, list)
    }
  }

  const live = (((classes as any[]) ?? []))
    .map((c) => {
      const days = (c.sessions ?? []).map((s: any) => s.session_date).sort()
      const close = String(c.registration_close_date ?? days[0] ?? c.start_date ?? '').slice(0, 10)
      if (!close || close < today) return null
      const school = one<any>(c.schools)
      const feederCities = feederCitiesByClass.get(c.id)
      const city = feederCities?.length
        ? feederCities.join(' & ')
        : publicTimeCityLabel({
            schoolCity: school?.city,
            displayCities: c.display_cities,
            location: c.default_location,
            timezone: c.timezone ?? school?.timezone ?? 'America/Denver',
            hglInPerson: !school && c.delivery_mode !== 'online',
          })
      const label = school ? `${school.name} ${c.class_type} Class` : c.class_type
      const starts = days[0] ?? c.start_date
      return `- ${label} (${city}; starts ${starts}): ${base}/c/${c.slug} — register at ${base}/register/${c.slug}`
    })
    .filter(Boolean)

  const body = `# Higher Ground Learning

Higher Ground Learning (HGL) provides SAT and ACT test preparation: live group
classes at international schools around the world, live online classes, local
classes in Salt Lake City, and 1-on-1 tutoring. Main site:
https://www.highergroundlearning.com

## How registration works
Each class has its own page with the live schedule, price, and registration
deadline. Registration happens on the class's register page and is confirmed
once the course fee is paid. Classes have capacity limits; full classes take
a waitlist.

## Classes open for registration right now
${live.length > 0 ? live.join('\n') : '- None at the moment — new classes are announced through partner schools and the main site.'}

## Partner schools
${(((schools as any[]) ?? []).map((s) => `- ${s.name}${s.city ? ` (${s.city})` : ''}`).join('\n')) || '- See the main site.'}

## Our team
${base}/team

## Contact
Free consultation: ${base}/inquire
Everything else: https://www.highergroundlearning.com
`
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
