import { NextResponse } from 'next/server'
import { appBaseUrl } from '../../utils/base-url'
import { INQUIRE_SPEC, embedResponseHeaders, embedScript } from '../../utils/embed-forms'

// PL-473: the Squarespace inquiry form, portal-fed. Snippet (paste once):
//   <div id="hgl-inquire" data-source="sqsp:/sat" data-interest="SAT">
//     <noscript><a href="https://hgl.co/inquire?source=sqsp:/sat&interest=SAT">Get in touch →</a></noscript>
//   </div>
//   <script src="{portal}/embed/inquire.js" defer></script>
export const dynamic = 'force-dynamic'
export async function GET() {
  return new NextResponse(embedScript(INQUIRE_SPEC, appBaseUrl()), { headers: embedResponseHeaders() })
}
