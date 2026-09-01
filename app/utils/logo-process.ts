// School-logo cleanup (July 8 refinements §2): uploaded crests usually sit on
// a solid white/near-white background that renders as a visible box against
// the flyer's accent-colored corner. Flood-fill from the image EDGES only —
// contiguous near-white pixels become transparent, then transparent borders
// are trimmed. Never a global white key: internal white elements (banner
// text, shield fields) must survive.
//
// PL-449: sharp loads LAZILY and GUARDED. A top-level `import sharp` meant a
// platform where the native module can't load (the Sep-1 prod incident: every
// sharp-importing route returned Next's raw 500 page on ANY request — the
// module graph died before a handler ever ran) killed collateral downloads,
// previews, the send panel, AND the logo upload in one blow. Now a load
// failure degrades exactly one FEATURE (logo processing) with a logged
// reason; callers decide their own fallback (the upload route refuses
// plainly; the collateral render passes the stored image through).

import type SharpNS from 'sharp'

const NEAR_WHITE = 0xf0 // ~#f0f0f0 and lighter
const MAX_EDGE = 1000 // logos render ~40mm — cap size, keep BFS + files small
const TRIM_PAD = 2 // px of breathing room around the trimmed crest

let sharpPromise: Promise<typeof SharpNS | null> | null = null

function loadSharp(): Promise<typeof SharpNS | null> {
  if (!sharpPromise) {
    sharpPromise = import('sharp')
      .then((m) => m.default)
      .catch((e) => {
        // Cache the failure for this instance — the binary won't appear
        // mid-lambda — but log it loudly every cold start it happens on.
        console.error('[PL-449] sharp failed to load — logo processing unavailable on this runtime:', e)
        return null
      })
  }
  return sharpPromise
}

/** True when the native image library is usable on this runtime. */
export async function sharpAvailable(): Promise<boolean> {
  return (await loadSharp()) !== null
}

/** The guarded sharp handle (null when unavailable) — for routes that use
 *  sharp directly (site-content image variants) without importing it at
 *  module scope. */
export function getSharp(): Promise<typeof SharpNS | null> {
  return loadSharp()
}

/** Cheap magic-byte sniff (no sharp needed): PNG / JPEG / GIF / WEBP / SVG.
 *  PL-449A: the corrupt SLS logo served 200 image/png but started EF BF BD —
 *  a binary that went through a UTF-8 text decode — so content-type and
 *  status are not proof; the bytes must look like an image. */
export function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true // GIF
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true // WEBP (RIFF....WEBP)
  const head = buf.subarray(0, 256).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return true // SVG
  return false
}

function nearWhite(data: Buffer, i: number): boolean {
  return data[i] >= NEAR_WHITE && data[i + 1] >= NEAR_WHITE && data[i + 2] >= NEAR_WHITE
}

/**
 * Returns the processed PNG, or null when the image comes out empty (e.g. an
 * all-white upload) OR when sharp itself is unavailable on this runtime —
 * callers treat null as "use the original". Throws only on undecodable
 * input (a real image-format problem the caller should refuse plainly).
 */
export async function processLogo(input: Buffer): Promise<Buffer | null> {
  const sharp = await loadSharp()
  if (!sharp) return null

  const { data, info } = await sharp(input)
    .rotate() // honor EXIF before pixel work
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  if (channels !== 4) return null

  // BFS flood fill from every border pixel that is near-white.
  const visited = new Uint8Array(width * height)
  const queue: number[] = []
  const push = (x: number, y: number) => {
    const p = y * width + x
    if (visited[p]) return
    visited[p] = 1
    if (nearWhite(data, p * 4)) {
      data[p * 4 + 3] = 0
      queue.push(p)
    }
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  // `visited` marks enqueued-or-rejected; only near-white pixels spread.
  while (queue.length > 0) {
    const p = queue.pop() as number
    const x = p % width
    const y = (p - x) / width
    if (x > 0) push(x - 1, y)
    if (x < width - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < height - 1) push(x, y + 1)
  }

  // Trim to the opaque bounding box (+padding).
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null // nothing left — refuse rather than store a blank

  minX = Math.max(0, minX - TRIM_PAD)
  minY = Math.max(0, minY - TRIM_PAD)
  maxX = Math.min(width - 1, maxX + TRIM_PAD)
  maxY = Math.min(height - 1, maxY + TRIM_PAD)

  return sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer()
}
