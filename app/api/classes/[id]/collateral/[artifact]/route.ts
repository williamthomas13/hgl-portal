import { createSupabaseServerClient } from '../../../../../utils/supabase-server'
import { supabaseAdmin } from '../../../../../utils/supabase-admin'
import { adminAllowlist } from '../../../../../utils/portal-auth'
import {
  collateralFilename,
  languagesFor,
  loadCollateralModel,
  type CollateralLanguage,
} from '../../../../../utils/collateral'
import { flyerHtml, letterHtml } from '../../../../../utils/collateral-templates'
import {
  loadStaticAssets,
  qrDataUrl,
  renderHtml,
  schoolLogoDataUrl,
  signatureDataUrl,
} from '../../../../../utils/collateral-render'

// Phase 4.5 collateral endpoints (spec §6):
//   /api/classes/{id}/collateral/{flyer|letter}.{pdf|jpg}?lang=en|es
// Always rendered from live data — collateral is a view of the class, never a
// stored document. Auth: staff plus that school's counselors (spec §6); the
// cookie session identifies the user, explicit checks scope the school.

export const maxDuration = 60 // headless Chromium cold start + render

const ARTIFACTS: Record<string, { type: 'flyer' | 'letter'; format: 'pdf' | 'jpg' }> = {
  'flyer.pdf': { type: 'flyer', format: 'pdf' },
  'flyer.jpg': { type: 'flyer', format: 'jpg' },
  'letter.pdf': { type: 'letter', format: 'pdf' },
  'letter.jpg': { type: 'letter', format: 'jpg' },
}

async function canDownload(email: string, schoolId: string | null): Promise<boolean> {
  const lower = email.trim().toLowerCase()
  if (adminAllowlist().includes(lower)) return true
  const [profile, affiliation] = await Promise.all([
    supabaseAdmin.from('profiles').select('role').ilike('email', lower).limit(1),
    schoolId
      ? supabaseAdmin
          .from('school_affiliations')
          .select('id, contacts!inner(email)')
          .eq('school_id', schoolId)
          .is('ended_at', null)
          .ilike('contacts.email', lower)
          .limit(1)
      : Promise.resolve({ data: [] }),
  ])
  const role = profile.data?.[0]?.role
  if (role === 'admin' || role === 'manager') return true
  return (affiliation.data?.length ?? 0) > 0
}

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/classes/[id]/collateral/[artifact]'>
) {
  const { id, artifact } = await ctx.params
  const spec = ARTIFACTS[artifact]
  if (!spec) return new Response('Not found', { status: 404 })

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return new Response('Sign in to download class materials', { status: 401 })

  const model = await loadCollateralModel(id)
  if (!model) return new Response('Class not found', { status: 404 })

  // schoolId comes off the class row via a service-role query
  const { data: cls } = await supabaseAdmin.from('classes').select('school_id').eq('id', id).single()
  if (!(await canDownload(user.email, cls?.school_id ?? null))) {
    return new Response('Not available for this account', { status: 403 })
  }

  const url = new URL(request.url)
  const langs = languagesFor(model)
  const requested = url.searchParams.get('lang')
  const lang: CollateralLanguage =
    requested === 'en' || requested === 'es'
      ? langs.includes(requested)
        ? requested
        : langs[0]
      : langs[0]

  // Stage-tagged failures: Vercel truncates messages in the dashboard list,
  // so the stage prefix is what makes a 500 diagnosable at a glance.
  let stage = 'load-assets'
  let bytes: Buffer
  try {
    const [statics, qr, signature, processedLogo] = await Promise.all([
      loadStaticAssets(),
      qrDataUrl(model.registerUrl),
      spec.type === 'letter' ? signatureDataUrl() : Promise.resolve(null),
      schoolLogoDataUrl(model.schoolLogoUrl),
    ])
    // PL-46: stale storage assets may still carry a white background — the
    // render always uses the edge-flood-processed inline copy.
    model.schoolLogoUrl = processedLogo
    stage = 'render'
    const assets = { ...statics, qrDataUrl: qr, signatureDataUrl: signature }
    const html =
      spec.type === 'flyer' ? flyerHtml(model, lang, assets) : letterHtml(model, lang, assets)
    bytes = await renderHtml(html, spec.format)
  } catch (e) {
    console.error(`collateral ${artifact} failed at ${stage} for class ${id}:`, e)
    return new Response(
      'Could not generate this file — the error has been logged. Try again in a minute.',
      { status: 500 }
    )
  }

  const filename = `${collateralFilename(model, spec.type, lang)}.${spec.format}`
  const inline = url.searchParams.get('inline') === '1' // admin preview thumbnails
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': spec.format === 'pdf' ? 'application/pdf' : 'image/jpeg',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      // Auth-gated and always-current: never let a shared cache hold a copy.
      'Cache-Control': 'private, no-store',
    },
  })
}
