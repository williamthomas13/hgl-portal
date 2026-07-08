import sharp from 'sharp'

// School-logo cleanup (July 8 refinements §2): uploaded crests usually sit on
// a solid white/near-white background that renders as a visible box against
// the flyer's accent-colored corner. Flood-fill from the image EDGES only —
// contiguous near-white pixels become transparent, then transparent borders
// are trimmed. Never a global white key: internal white elements (banner
// text, shield fields) must survive.

const NEAR_WHITE = 0xf0 // ~#f0f0f0 and lighter
const MAX_EDGE = 1000 // logos render ~40mm — cap size, keep BFS + files small
const TRIM_PAD = 2 // px of breathing room around the trimmed crest

function nearWhite(data: Buffer, i: number): boolean {
  return data[i] >= NEAR_WHITE && data[i + 1] >= NEAR_WHITE && data[i + 2] >= NEAR_WHITE
}

/**
 * Returns the processed PNG, or null when the image comes out empty (e.g. an
 * all-white upload) — callers treat null as "store the original".
 */
export async function processLogo(input: Buffer): Promise<Buffer | null> {
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
