import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'

// PL-350: the public class pages' counting beacon. First-party only: the
// payload is a class id + metric names, and that's ALL that's stored (per
// class, per Denver day). No cookies are read or set, no IP or user agent
// is persisted, and Do-Not-Track / Global Privacy Control requests are
// dropped here too (the client already respects them — this is the belt).

// PL-352: 'pitch' left the page (the upsell lives on the registration flow).
const METRIC_RE = /^(visit|register-click|arrival:shortlink|section:(hero|schedule|whats-included|curriculum|instructors|faq|fine-print|closing))$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  // Honor the browser's do-not-track signals server-side as well.
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') {
    return new NextResponse(null, { status: 204 })
  }
  const body = await request.json().catch(() => null)
  const classId = typeof body?.classId === 'string' ? body.classId : ''
  const metrics = Array.isArray(body?.metrics)
    ? [...new Set(body.metrics.filter((m: unknown) => typeof m === 'string' && METRIC_RE.test(m)))].slice(0, 12)
    : []
  if (!UUID_RE.test(classId) || metrics.length === 0) {
    return new NextResponse(null, { status: 204 }) // junk is dropped, never debated
  }
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  // Table/function may not be migrated yet, or the class id may be stale —
  // counting silently declines rather than erroring at a parent's browser.
  await supabase
    .rpc('bump_class_page_metrics', { p_class_id: classId, p_day: day, p_metrics: metrics })
    .then(
      () => {},
      () => {}
    )
  return new NextResponse(null, { status: 204 })
}
