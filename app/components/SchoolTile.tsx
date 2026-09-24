// PL-479: the school-logo tile for the /classes cards and the homepage
// embed — the logo contained on a white tile so mixed aspect ratios look
// deliberate; a graceful MONOGRAM tile in the school's accent color when a
// logo is missing. Never a broken image.
import { usableAccent } from '../utils/accent'
import { schoolMonogram } from '../utils/school-monogram'

/** PL-508: the nickname when the school has one, initials otherwise (ONE rule: school-monogram.ts). */
export function monogram(name: string, nickname?: string | null): string {
  return schoolMonogram(nickname, name)
}

export default function SchoolTile({
  logoUrl,
  name,
  nickname = null,
  accentColor,
  size = 'md',
}: {
  logoUrl: string | null | undefined
  name: string
  /** PL-508: the logo-less tile reads the nickname ("Nido"), never full-name initials. */
  nickname?: string | null
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
      className="inline-flex self-start items-center justify-center rounded-md text-white font-extrabold tracking-wide h-[72px] min-w-[72px] px-2 text-xl"
      style={{ background: usableAccent(accentColor ?? null) }}
      data-testid="school-tile-monogram"
    >
      {monogram(name, nickname)}
    </span>
  )
}
