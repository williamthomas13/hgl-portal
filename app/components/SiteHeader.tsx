import Link from 'next/link'
import { loadSiteNav, MAIN_SITE, visibleNav } from '../utils/site-nav'
import { publicSkin } from './public-skin'
import NavFolder from './NavFolder'

// PL-478: the shared public site header — mirrors highergroundlearning.com's
// menu so a visitor on any public portal page can get anywhere the main site
// goes. Server component (reads the editable nav list); the mobile sheet is a
// no-JS <details> so nothing shifts. NOT rendered on signed-in surfaces or
// the checkout-focus register steps (those get `variant="compact"`: logo +
// "Back to class" only). Embeds never render it.
//
// PL-492 (Scarlett, Sep 22): it now LOOKS like the main site's, not just
// links like it — Pontano Sans 17px regular items ~26px apart, the wordmark
// ~60px tall in a ~104px bar with the main site's gutters, the blue
// "Free Consultation" button at its size, the "Tutoring" folder. Two tones:
// `white` (a white bar, black text — /inquire, /compass, /partner, the
// notice cards) and `overlay` (transparent, white text, sitting ON the hero
// image — /classes, /team, the class page; the hero clears it with
// HEADER_CLEARANCE and a soft top band keeps the nav text measurable).

/** The hero's top padding that clears the overlay header (same heights). */
export const HEADER_CLEARANCE = 'pt-16 sm:pt-20 lg:pt-[104px]'

export default async function SiteHeader({
  current,
  variant = 'full',
  tone = 'white',
  backHref,
  backLabel = 'Back to class',
}: {
  current?: 'classes' | 'team' | null
  variant?: 'full' | 'compact'
  tone?: 'white' | 'overlay'
  backHref?: string | null
  backLabel?: string
}) {
  const nav = variant === 'full' ? visibleNav((await loadSiteNav()).header) : []
  const overlay = tone === 'overlay'
  const isCurrent = (key?: string) => Boolean(key && key === current)
  const logo = overlay ? '/collateral/hgl-logo-white.png' : '/collateral/hgl-logo-color.png'
  const item = overlay ? 'hover:text-white/80' : 'hover:text-hgl-blue'
  const currentCls = overlay ? 'underline underline-offset-8 decoration-2' : 'text-hgl-blue'
  return (
    <header
      className={`${publicSkin} ${overlay ? 'absolute inset-x-0 top-0 z-30 text-white' : 'relative bg-white border-b border-gray-200 text-black'}`}
      data-testid="site-header"
      data-variant={variant}
      data-tone={tone}
    >
      {overlay && (
        // The band behind the nav: the scrim alone measures ~3.3:1 under a
        // headline, which is fine for 36px bold text but not for 17px regular
        // nav links — this eases the top of the hero darker so the links hold
        // AA (measured in scripts/smoke-public-pages.mjs, PL-492).
        <div aria-hidden className="absolute inset-x-0 top-0 h-[150%] bg-gradient-to-b from-black/60 via-black/30 to-transparent pointer-events-none" />
      )}
      <div className="relative mx-auto max-w-[1500px] px-5 sm:px-8 lg:px-[57px] h-16 sm:h-20 lg:h-[104px] flex items-center justify-between gap-6">
        <a href={MAIN_SITE} className="shrink-0 flex items-center" aria-label="Higher Ground Learning — home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="Higher Ground Learning" width={107} height={60} className="h-10 sm:h-12 lg:h-[60px] w-auto" />
        </a>
        {variant === 'compact' ? (
          backHref ? (
            <a href={backHref} className="text-[17px] text-hgl-blue underline" data-testid="header-back">← {backLabel}</a>
          ) : null
        ) : (
          <>
            <nav className="hidden lg:flex items-center gap-[26px] text-[17px] font-normal" aria-label="Site" data-nav-desktop>
              {nav.map((it) =>
                it.children ? (
                  <NavFolder key={it.label} label={it.label} items={it.children.map((c) => ({ label: c.label, url: c.url }))} tone={tone} />
                ) : (
                  <a
                    key={it.url + it.label}
                    href={it.url}
                    aria-current={isCurrent(it.key) ? 'page' : undefined}
                    className={`whitespace-nowrap ${item} ${isCurrent(it.key) ? currentCls : ''}`}
                    data-nav-top={it.label}
                  >
                    {it.label}
                  </a>
                )
              )}
            </nav>
            <div className="flex items-center gap-3 sm:gap-5">
              <Link
                href="/inquire?source=header"
                className="hidden sm:inline-flex items-center bg-hgl-blue text-white text-[17px] leading-[21px] px-5 py-[18px] lg:py-5 rounded-[7px] hover:bg-hgl-blue-hover whitespace-nowrap"
                data-testid="header-consult"
              >
                Free Consultation
              </Link>
              <Link href="/login" className={`text-[17px] ${overlay ? 'text-white/85 hover:text-white' : 'text-gray-600 hover:text-black'}`} data-testid="header-signin">
                Sign in
              </Link>
              {/* Mobile / tablet: the same items in a sheet — a no-JS <details>, so no layout shift. */}
              <details className="lg:hidden relative">
                <summary className={`list-none cursor-pointer p-2 -mr-2 rounded ${overlay ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`} aria-label="Menu" data-testid="header-menu">
                  <span aria-hidden className={`block w-6 h-0.5 mb-1.5 ${overlay ? 'bg-white' : 'bg-black'}`} />
                  <span aria-hidden className={`block w-6 h-0.5 mb-1.5 ${overlay ? 'bg-white' : 'bg-black'}`} />
                  <span aria-hidden className={`block w-6 h-0.5 ${overlay ? 'bg-white' : 'bg-black'}`} />
                </summary>
                <nav className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white text-black border border-gray-200 rounded-lg shadow-lg p-2 z-40 text-[17px]" aria-label="Site (mobile)" data-nav-mobile>
                  {nav.map((it) =>
                    it.children ? (
                      // PL-492: the folder is an expandable group in the sheet (no-JS <details>).
                      <details key={it.label} className="group" data-nav-folder={it.label}>
                        <summary className="list-none cursor-pointer flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50">
                          {it.label}
                          <span aria-hidden className="text-xs transition-transform group-open:rotate-180">▾</span>
                        </summary>
                        <div className="pl-3 pb-1">
                          {it.children.map((c) => (
                            <a key={c.url + c.label} href={c.url} className="block px-3 py-2 rounded hover:bg-gray-50" data-nav-child={c.label}>
                              {c.label}
                            </a>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <a
                        key={it.url + it.label}
                        href={it.url}
                        aria-current={isCurrent(it.key) ? 'page' : undefined}
                        className={`block px-3 py-2 rounded ${isCurrent(it.key) ? 'text-hgl-blue bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        {it.label}
                      </a>
                    )
                  )}
                  <Link href="/inquire?source=header" className="block mt-1 px-3 py-3 rounded-[7px] text-white bg-hgl-blue text-center">
                    Free Consultation
                  </Link>
                </nav>
              </details>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
