// PL-483: co-branding — HGL mark · thin divider · the school's logo, equal
// optical height, on the class-page hero and every state card. Collapses to
// HGL-only when the school has no logo (never two HGL logos: the school slot
// is simply absent). Viewport rule, because PL-478's site header carries the
// HGL logo on every public page: at 375px the header IS the HGL mark, so the
// lockup shows the SCHOOL logo only (nothing when there is none); from `sm`
// up the header + the full lockup both render (two HGL marks, never three).
// The same rule applies to the /classes hero mark.

export default function BrandLockup({
  schoolLogo,
  schoolName,
  tone = 'color',
  size = 'md',
  className = '',
  hglMark = true,
}: {
  schoolLogo: string | null | undefined
  schoolName?: string | null
  /** 'white' on the mural hero (white HGL mark, white tile for the school). */
  tone?: 'color' | 'white'
  size?: 'md' | 'lg'
  className?: string
  /** PL-492: false under the overlay header (it carries the HGL mark on the hero). */
  hglMark?: boolean
}) {
  const h = size === 'lg' ? 'h-14' : 'h-10'
  const hglSrc = tone === 'white' ? '/collateral/hgl-logo-white.png' : '/collateral/hgl-logo-color.png'
  const divider = tone === 'white' ? 'bg-white/40' : 'bg-gray-300'
  return (
    <div className={`flex items-center gap-3 ${className}`} data-testid="brand-lockup" data-lockup={schoolLogo ? (hglMark ? 'hgl-x-school' : 'school-only') : hglMark ? 'hgl-only' : 'none'}>
      {/* HGL mark: hidden at phone width — the PL-478 site header carries it
          there (ONE HGL mark per viewport); from `sm` up header + lockup both show. */}
      {hglMark && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hglSrc}
          alt="Higher Ground Learning"
          width={size === 'lg' ? 100 : 71}
          height={size === 'lg' ? 56 : 40}
          className={`${h} w-auto hidden sm:block`}
        />
      )}
      {schoolLogo && (
        <>
          {hglMark && <span aria-hidden className={`hidden sm:block w-px self-stretch ${divider}`} />}
          <span className={`inline-flex items-center bg-white rounded-md ${size === 'lg' ? 'p-2' : 'p-1.5'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={schoolLogo} alt={schoolName ? `${schoolName} logo` : 'School logo'} className={`${h} w-auto max-w-[9rem] object-contain`} />
          </span>
        </>
      )}
    </div>
  )
}
