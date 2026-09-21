import { NextResponse } from 'next/server'
import { appBaseUrl } from '../../utils/base-url'
import { PARTNER_SPEC, embedResponseHeaders, embedScript } from '../../utils/embed-forms'

// PL-477: the /examzen school-partnership form, portal-fed (leads of kind 'school').
export const dynamic = 'force-dynamic'
export async function GET() {
  return new NextResponse(embedScript(PARTNER_SPEC, appBaseUrl()), { headers: embedResponseHeaders() })
}
