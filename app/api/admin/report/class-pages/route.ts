import { NextResponse } from 'next/server'
import { sessionRole } from '../../../../utils/staff-gate'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'

// PL-350: "what do parents actually read?" — the report page's rollup over
// the class-page counters. Counts only (no dollars anywhere), so admins and
// managers see the same thing. ?from=YYYY-MM&to=YYYY-MM scopes to the
// report page's PL-347 period; absent bounds mean all time.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

const MONTH_RE = /^\d{4}-\d{2}$/

export async function GET(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const url = new URL(request.url)
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''

  let query = supabase.from('class_page_daily').select('class_id, day, metric, count')
  // ISO date strings compare lexically; "-31" is a safe inclusive upper
  // bound for any month.
  if (MONTH_RE.test(from)) query = query.gte('day', `${from}-01`)
  if (MONTH_RE.test(to)) query = query.lte('day', `${to}-31`)
  const [{ data: rows, error }, { data: classes }] = await Promise.all([
    query,
    supabase.from('classes').select('id, class_type, slug, schools ( nickname )'),
  ])
  if (error) {
    return NextResponse.json(
      { error: 'The class-page analytics table is not set up yet — apply the PL-350 migration first.' },
      { status: 503 }
    )
  }

  const labelById = new Map<string, { label: string; slug: string | null }>()
  for (const c of ((classes as any[]) ?? [])) {
    labelById.set(c.id, {
      label: `${one<any>(c.schools)?.nickname ?? ''} ${c.class_type}`.trim(),
      slug: c.slug ?? null,
    })
  }

  type Agg = {
    visits: number
    registerClicks: number
    shortlinkArrivals: number
    sections: Record<string, number>
  }
  const empty = (): Agg => ({ visits: 0, registerClicks: 0, shortlinkArrivals: 0, sections: {} })
  const byClass = new Map<string, Agg>()
  const totals = empty()
  const add = (agg: Agg, metric: string, n: number) => {
    if (metric === 'visit') agg.visits += n
    else if (metric === 'register-click') agg.registerClicks += n
    else if (metric === 'arrival:shortlink') agg.shortlinkArrivals += n
    else if (metric.startsWith('section:')) {
      const s = metric.slice('section:'.length)
      agg.sections[s] = (agg.sections[s] ?? 0) + n
    }
  }
  for (const r of ((rows as any[]) ?? [])) {
    const agg = byClass.get(r.class_id) ?? empty()
    add(agg, r.metric, r.count)
    byClass.set(r.class_id, agg)
    add(totals, r.metric, r.count)
  }

  return NextResponse.json({
    classes: [...byClass.entries()]
      .map(([id, agg]) => ({
        id,
        label: labelById.get(id)?.label ?? 'Deleted class',
        slug: labelById.get(id)?.slug ?? null,
        ...agg,
      }))
      .sort((a, b) => b.visits - a.visits),
    totals,
  })
}
