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
  // PL-491: ~72px tall on every card state (wide wordmarks — ISP, ASM, ULIS,
  // ISM — were unreadable at 34px); up to ~160px wide, object-contain, a
  // little padding — wide logos take the width, square crests stay square,
  // never cropped or stretched. The monogram is a matching 72px square.
  void size
  if (logoUrl) {
    return (
      <span className="inline-flex self-start items-center justify-center bg-white rounded-md border border-gray-100 p-2 h-[72px] max-w-[160px]" data-testid="school-tile">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={`${name} logo`} className="h-full w-auto max-w-[144px] object-contain" loading="lazy" decoding="async" />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className="inline-flex self-start items-center justify-center rounded-md text-white font-extrabold tracking-wide text-2xl h-[72px] w-[72px]"
      style={{ background: usableAccent(accentColor ?? null) }}
      data-testid="school-tile-monogram"
    >
      {monogram(name) || 'HGL'}
    </span>
  )
}
