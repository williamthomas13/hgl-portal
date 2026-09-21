import { NextResponse } from 'next/server'
import { appBaseUrl } from '../../utils/base-url'
import { COMPASS_SPEC, embedResponseHeaders, embedScript } from '../../utils/embed-forms'

// PL-477: the College Prep Compass signup (the footer block on every sqsp page
// + /college-prep-compass), portal-fed → marketing_subscribers.
export const dynamic = 'force-dynamic'
export async function GET() {
  return new NextResponse(embedScript(COMPASS_SPEC, appBaseUrl()), { headers: embedResponseHeaders() })
}
