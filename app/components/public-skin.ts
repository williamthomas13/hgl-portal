// PL-374/378: the public pages' shared skin — the brand body face (Pontano
// Sans, a Google font, self-hosted via next/font) and the brand hero image
// (the SLC-headquarters shot, served from OUR bucket — never squarespace-cdn,
// which dies at decommission). /c, /team, and /classes all pull from here.

import { Montserrat, Pontano_Sans, Source_Serif_4 } from 'next/font/google'
import type { ClassPageImage } from '../utils/class-page-images'

export const pontano = Pontano_Sans({ subsets: ['latin'], weight: ['400', '700'] })

// PL-408 (Scarlett approved, Aug 29): the sqsp site's hierarchy — serif
// display headings (adonis-web there) + a geometric sans for buttons/UI
// accents (proxima-nova there). Neither is self-hostable, so the approved
// stand-ins are Source Serif 4 (headings, 600/700 — the sqsp headings sit
// at semibold/bold) and Montserrat (buttons, 600/700). Wired as CSS
// variables + the .public-skin scope rules in globals.css so every heading
// and .public-cta on a skinned page rides them without per-site edits.
export const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-heading-serif',
})
export const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-button-sans',
})

/** The ONE class string public pages wear: body face + heading/button
 *  variables + the .public-skin scope. */
export const publicSkin = `${pontano.className} ${sourceSerif.variable} ${montserrat.variable} public-skin`

export const PAGE_HERO: ClassPageImage = {
  path: 'hero/hgl-hq-2500w.webp',
  alt: 'The Higher Ground Learning space in downtown Salt Lake City — mountain mural, foosball table, and mezzanine',
  width: 2500,
  height: 1667,
  variants: [
    { path: 'hero/hgl-hq-800w.webp', width: 800 },
    { path: 'hero/hgl-hq-1600w.webp', width: 1600 },
    { path: 'hero/hgl-hq-2500w.webp', width: 2500 },
  ],
}
