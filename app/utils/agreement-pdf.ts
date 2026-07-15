import { supabaseAdmin as supabase } from './supabase-admin'
import { renderMarkdownBody } from './comms-md'
import type { Browser } from 'puppeteer-core'

// Phase 7e agreement PDF snapshots (docs/PHASE7_SPEC.md §12): a simple
// typographic document of the EXACT text accepted, rendered with the Phase
// 4.5 chromium pipeline (puppeteer-core + @sparticuz/chromium on Vercel,
// local Chrome elsewhere) and stored in the private collateral-private
// bucket at agreements/{acceptanceId}.pdf. Deliberately NOT reusing
// collateral-render.renderHtml — that one is pinned to a single A4 page
// (pageRanges: '1'); policies flow across pages. Kept light: system fonts,
// no embedded assets.

let browserPromise: Promise<Browser> | null = null

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import('puppeteer-core')
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }
  const local =
    process.env.CHROME_EXECUTABLE ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return puppeteer.launch({
    executablePath: local,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
}

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((e) => {
      browserPromise = null // don't cache a failed launch
      throw e
    })
  }
  return browserPromise
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The snapshot document: policy text + the acceptance record, nothing else. */
export function agreementSnapshotHtml(opts: {
  bodyMarkdown: string
  version: number
  effectiveDate: string | null
  acceptedByName: string
  acceptedByEmail: string | null
  acceptedAtIso: string
  ip: string | null
  userAgent: string | null
}): string {
  const acceptedAt = new Date(opts.acceptedAtIso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    dateStyle: 'long',
    timeStyle: 'short',
  })
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.55;
         font-size: 12.5px; margin: 0; padding: 0; }
  h2 { color: #334155; font-size: 21px; margin: 6px 0 12px; }
  h3 { color: #334155; font-size: 15px; margin: 18px 0 6px; }
  ul { padding-left: 20px; margin: 6px 0; }
  li { margin: 3px 0; }
  .brand { color: #506171; font-weight: bold; font-size: 14px; letter-spacing: 0.5px;
           border-bottom: 3px solid #00AEEE; padding-bottom: 8px; margin-bottom: 18px; }
  .meta { color: #64748b; font-size: 11px; margin-bottom: 16px; }
  .acceptance { margin-top: 28px; border-top: 1px solid #cbd5e1; padding-top: 14px;
                font-size: 11.5px; color: #334155; page-break-inside: avoid; }
  .acceptance td { padding: 2px 12px 2px 0; vertical-align: top; }
  .acceptance .k { color: #64748b; white-space: nowrap; }
</style></head><body>
  <div class="brand">HIGHER GROUND LEARNING</div>
  <div class="meta">Policy version ${opts.version}${
    opts.effectiveDate ? ` · effective ${opts.effectiveDate}` : ''
  } · This document is a snapshot of the exact text accepted.</div>
  ${renderMarkdownBody(opts.bodyMarkdown, {})}
  <div class="acceptance">
    <strong>Acceptance record</strong>
    <table>
      <tr><td class="k">Accepted by</td><td>${esc(opts.acceptedByName)}${
        opts.acceptedByEmail ? ` &lt;${esc(opts.acceptedByEmail)}&gt;` : ''
      }</td></tr>
      <tr><td class="k">Accepted at</td><td>${acceptedAt} (Mountain Time)</td></tr>
      ${opts.ip ? `<tr><td class="k">IP address</td><td>${esc(opts.ip)}</td></tr>` : ''}
      ${opts.userAgent ? `<tr><td class="k">Browser</td><td>${esc(opts.userAgent)}</td></tr>` : ''}
    </table>
  </div>
</body></html>`
}

async function renderPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const pdf = await page.pdf({
      format: 'a4',
      printBackground: true,
      margin: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Render + upload the PDF snapshot for an acceptance, best-effort: the
 * acceptance row is already recorded and MUST survive any failure here — a
 * failure just leaves pdf_error set for the admin retry button.
 */
export async function snapshotAcceptancePdf(
  acceptanceId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: acc } = await supabase
      .from('agreement_acceptances')
      .select(
        `id, accepted_by_name, accepted_by_email, accepted_at, ip, user_agent,
         agreement_templates ( version, effective_date, body_markdown )`
      )
      .eq('id', acceptanceId)
      .maybeSingle()
    if (!acc) return { ok: false, error: 'Unknown acceptance.' }
    const tplRaw = acc.agreement_templates
    const tpl = Array.isArray(tplRaw) ? tplRaw[0] : tplRaw
    if (!tpl) return { ok: false, error: 'Template missing.' }

    const html = agreementSnapshotHtml({
      bodyMarkdown: tpl.body_markdown,
      version: tpl.version,
      effectiveDate: tpl.effective_date,
      acceptedByName: acc.accepted_by_name,
      acceptedByEmail: acc.accepted_by_email,
      acceptedAtIso: acc.accepted_at,
      ip: acc.ip,
      userAgent: acc.user_agent,
    })
    const pdf = await renderPdf(html)
    const path = `agreements/${acceptanceId}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('collateral-private')
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (uploadError) throw new Error(uploadError.message)

    await supabase
      .from('agreement_acceptances')
      .update({ pdf_snapshot_path: path, pdf_error: null })
      .eq('id', acceptanceId)
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`agreement PDF snapshot failed for ${acceptanceId}:`, message)
    // The acceptance stands; note the failure for the admin retry button.
    await supabase
      .from('agreement_acceptances')
      .update({ pdf_error: `snapshot failed: ${message.slice(0, 300)}` })
      .eq('id', acceptanceId)
    return { ok: false, error: message }
  }
}
