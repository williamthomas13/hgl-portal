// Regenerates the processed collateral art in public/collateral from the
// raw brand sources in this folder. Run from anywhere with sharp available:
//   npm i --no-save sharp && node docs/brand-assets/prep-assets.mjs
import sharp from 'sharp'

const SRC = new URL('.', import.meta.url).pathname // docs/brand-assets
const OUT = new URL('../../public/collateral', import.meta.url).pathname

// 1. White-silhouette full logo (flyer header sits on the blue shape).
//    Luminance threshold -> alpha mask, slight blur to soften 1-bit edges.
async function whiteLogo() {
  const src = sharp(`${SRC}/Copia de 2.jpg`) // color logo, tight crop, white bg
  const { width, height } = await src.metadata()
  const mask = await sharp(`${SRC}/Copia de 2.jpg`)
    .greyscale()
    .threshold(235) // white bg -> white, logo -> black
    .negate() // logo -> white (opaque), bg -> black (transparent)
    .blur(0.4)
    .toBuffer()
  await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .joinChannel(mask)
    .png()
    .toFile(`${OUT}/hgl-logo-white.png`)
}

// 2. Color logo with transparent bg (letter header on white — transparency is
//    belt-and-braces, edges keep a faint white fringe that is invisible there).
async function colorLogo() {
  const mask = await sharp(`${SRC}/Copia de 2.jpg`)
    .greyscale()
    .threshold(235)
    .negate()
    .blur(0.4)
    .toBuffer()
  await sharp(`${SRC}/Copia de 2.jpg`).removeAlpha().joinChannel(mask).png().toFile(`${OUT}/hgl-logo-color.png`)
}

// 3. Hero photo: 5.2MB PNG -> ~1400px-wide JPG (renders ~86mm wide on A4).
async function hero() {
  await sharp(`${SRC}/Hero Picture.png`)
    .resize({ width: 1400 })
    .jpeg({ quality: 82 })
    .toFile(`${OUT}/hero.jpg`)
}

// 4. Brush ring: the source is slate-on-WHITE (no alpha). Build a proper alpha
//    channel: darkness -> opacity, scaled so the slate body (#506171, lum≈96)
//    is fully opaque and white is fully transparent; edge pixels interpolate.
async function brush() {
  const resized = sharp(`${SRC}/Brush Ring.png`).resize({ width: 900 })
  const alpha = await resized
    .clone()
    .greyscale()
    .linear(-255 / 159, (255 * 255) / 159)
    .toBuffer()
  const { width, height } = await sharp(alpha).metadata()
  await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .joinChannel(alpha)
    .png()
    .toFile(`${OUT}/brush-ring.png`)
}

await Promise.all([whiteLogo(), colorLogo(), hero(), brush()])
console.log('done')
