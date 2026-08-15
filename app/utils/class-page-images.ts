// PL-351: the class pages' image descriptor — ONE shape shared by
// site_content_blocks.image and classes.hero_image, and the helpers that
// turn it into a responsive <img>. Files live in the public 'class-pages'
// Storage bucket; variants are pre-generated at upload time (sharp), so a
// real srcset needs no image-transformation service. Client-safe: only
// NEXT_PUBLIC env is read.

export type ClassPageImage = {
  /** Largest rendition's storage path (within the class-pages bucket). */
  path: string
  /** REQUIRED — enforced by a DB check constraint and the upload route. */
  alt: string
  /** Blocks only: where the image sits beside the text. */
  layout?: 'left' | 'right' | 'hero'
  width: number
  height: number
  variants: { path: string; width: number }[]
}

export const CLASS_PAGE_BUCKET = 'class-pages'

export function storagePublicUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  return `${base}/storage/v1/object/public/${CLASS_PAGE_BUCKET}/${path}`
}

/** src/srcSet/dimension attributes for a descriptor — spread onto an <img>. */
export function imageAttrs(image: ClassPageImage): {
  src: string
  srcSet?: string
  width: number
  height: number
  alt: string
} {
  const variants = [...(image.variants ?? [])].sort((a, b) => a.width - b.width)
  return {
    src: storagePublicUrl(image.path),
    srcSet: variants.length
      ? variants.map((v) => `${storagePublicUrl(v.path)} ${v.width}w`).join(', ')
      : undefined,
    width: image.width,
    height: image.height,
    alt: image.alt,
  }
}

/** Parse a jsonb column value into a descriptor, or null if malformed —
 *  a broken row must degrade to the text-only block, never a broken frame. */
export function parseClassPageImage(v: unknown): ClassPageImage | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.path !== 'string' || !o.path) return null
  if (typeof o.alt !== 'string' || !o.alt.trim()) return null
  if (typeof o.width !== 'number' || typeof o.height !== 'number') return null
  return {
    path: o.path,
    alt: o.alt,
    layout: o.layout === 'left' || o.layout === 'right' || o.layout === 'hero' ? o.layout : undefined,
    width: o.width,
    height: o.height,
    variants: Array.isArray(o.variants)
      ? (o.variants as { path: string; width: number }[]).filter(
          (x) => typeof x?.path === 'string' && typeof x?.width === 'number'
        )
      : [],
  }
}
