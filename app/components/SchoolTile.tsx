// PL-479: the school-logo tile for the /classes cards and the homepage
// embed — the logo contained on a white tile so mixed aspect ratios look
// deliberate; a graceful MONOGRAM tile in the school's accent color when a
// logo is missing. Never a broken image.
import { usableAccent } from '../utils/collateral'

export function monogram(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and|de|del|di|la|le|du)$/i.test(w))
    .map((w) => w[0].toUpperCase())
    .slice(0, 3)
    .join('')
}

export default function SchoolTile({
  logoUrl,
  name,
  accentColor,
  size = 'md',
}: {
  logoUrl: string | null | undefined
  name: string
  accentColor?: string | null
  size?: 'sm' | 'md'
}) {
  const box = size === 'sm' ? 'h-12 w-16' : 'h-16 w-24'
  if (logoUrl) {
    return (
      <span className={`inline-flex items-center justify-center bg-white rounded-md border border-gray-100 p-1.5 ${box}`} data-testid="school-tile">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={`${name} logo`} className="max-h-full max-w-full object-contain" loading="lazy" decoding="async" />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-md text-white font-extrabold tracking-wide ${size === 'sm' ? 'text-sm' : 'text-lg'} ${box}`}
      style={{ background: usableAccent(accentColor ?? null) }}
      data-testid="school-tile-monogram"
    >
      {monogram(name) || 'HGL'}
    </span>
  )
}
