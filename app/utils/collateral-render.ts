import { readFile } from 'fs/promises'
import path from 'path'
import QRCode from 'qrcode'
import { supabaseAdmin } from './supabase-admin'
import type { Browser } from 'puppeteer-core'
import type { StaticAssets } from './collateral-templates'

// Headless-Chromium rendering for Phase 4.5 collateral (spec §6). One HTML
// template → pixel-identical A4 PDF and ~1600px JPG. On Vercel we run
// @sparticuz/chromium; locally whatever Chrome is installed (or
// CHROME_EXECUTABLE). The browser is cached per warm lambda.

const A4_PX = { width: 794, height: 1123 } // 210×297mm at CSS 96dpi
const JPG_SCALE = 1600 / A4_PX.height // spec §2: ~1600px long edge

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

export async function renderHtml(
  html: string,
  format: 'pdf' | 'jpg'
): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setViewport({
      width: A4_PX.width,
      height: A4_PX.height,
      deviceScaleFactor: format === 'jpg' ? JPG_SCALE : 1,
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    // Everything except school logos is inlined; wait for fonts plus any
    // remote <img> (logo) before printing.
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r)))
        )
      )
    })
    if (format === 'pdf') {
      const pdf = await page.pdf({
        format: 'a4',
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        pageRanges: '1',
      })
      return Buffer.from(pdf)
    }
    const jpg = await page.screenshot({
      type: 'jpeg',
      quality: 92,
      clip: { x: 0, y: 0, width: A4_PX.width, height: A4_PX.height },
    })
    return Buffer.from(jpg)
  } finally {
    await page.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Static assets are inlined as data URLs: Chromium fetches CSS mask images
// with CORS (which a setContent page can never satisfy), and the serverless
// function can't assume public/ is served next to it — so everything the
// templates need ships inside the HTML string. next.config's
// outputFileTracingIncludes bundles public/collateral into the function.
// ---------------------------------------------------------------------------

let staticAssetsPromise: Promise<StaticAssets> | null = null

async function readDataUrl(file: string, mime: string): Promise<string> {
  const buf = await readFile(path.join(process.cwd(), 'public', 'collateral', file))
  return `data:${mime};base64,${buf.toString('base64')}`
}

export function loadStaticAssets(): Promise<StaticAssets> {
  if (!staticAssetsPromise) {
    staticAssetsPromise = (async () => {
      const [brushMask, logoWhite, logoColor, hero, ...fonts] = await Promise.all([
        readDataUrl('brush-ring.png', 'image/png'),
        readDataUrl('hgl-logo-white.png', 'image/png'),
        readDataUrl('hgl-logo-color.png', 'image/png'),
        readDataUrl('hero.jpg', 'image/jpeg'),
        ...(
          [
            [300, 'Poppins-Light'],
            [400, 'Poppins-Regular'],
            [500, 'Poppins-Medium'],
            [600, 'Poppins-SemiBold'],
            [700, 'Poppins-Bold'],
            [800, 'Poppins-ExtraBold'],
          ] as const
        ).map(async ([weight, file]) => ({
          weight,
          dataUrl: await readDataUrl(`fonts/${file}.ttf`, 'font/ttf'),
        })),
      ])
      return { brushMask, logoWhite, logoColor, hero, fonts } as StaticAssets
    })().catch((e) => {
      staticAssetsPromise = null
      throw e
    })
  }
  return staticAssetsPromise
}

/** QR for the flyer: slate modules, transparent background, generated locally
 *  at render time (spec §6 — no external QR service). */
export function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 600,
    color: { dark: '#506171ff', light: '#0000' },
  })
}

// ---------------------------------------------------------------------------
// Signature image: deliberately NOT in this public repo. It lives in the
// private `collateral-private` storage bucket (object: signature.png) and is
// fetched with the service role at render time, inlined as a data URL. A
// missing object degrades gracefully to the typed signature block.
// ---------------------------------------------------------------------------

let signatureCache: { value: string | null; at: number } | null = null
const SIGNATURE_TTL_MS = 10 * 60_000

export async function signatureDataUrl(): Promise<string | null> {
  if (signatureCache && Date.now() - signatureCache.at < SIGNATURE_TTL_MS) {
    return signatureCache.value
  }
  const { data, error } = await supabaseAdmin.storage
    .from('collateral-private')
    .download('signature.png')
  let value: string | null = null
  if (!error && data) {
    const buf = Buffer.from(await data.arrayBuffer())
    value = `data:image/png;base64,${buf.toString('base64')}`
  }
  signatureCache = { value, at: Date.now() }
  return value
}
