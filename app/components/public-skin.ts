// PL-374/378: the public pages' shared skin — the brand body face (Pontano
// Sans, a Google font, self-hosted via next/font) and the brand hero image
// (the SLC-headquarters shot, served from OUR bucket — never squarespace-cdn,
// which dies at decommission). /c, /team, and /classes all pull from here.

import { Pontano_Sans } from 'next/font/google'
import type { ClassPageImage } from '../utils/class-page-images'

export const pontano = Pontano_Sans({ subsets: ['latin'], weight: ['400', '700'] })

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
