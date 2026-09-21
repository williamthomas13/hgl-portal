import Link from 'next/link'
import { loadSiteNav, MAIN_SITE } from '../utils/site-nav'

// PL-478: the shared public site header — mirrors highergroundlearning.com's
// menu so a visitor on any public portal page can get anywhere the main site
// goes. Server component (reads the editable nav list); the mobile sheet is a
// no-JS <details> so nothing shifts. NOT rendered on signed-in surfaces or
// the checkout-focus register steps (those get `variant="compact"`: logo +
// "Back to class" only). Embeds never render it.

export default async function SiteHeader({
  current,
  variant = 'full',
  backHref,
  backLabel = 'Back to class',
}: {
  current?: 'classes' | 'team' | null
  variant?: 'full' | 'compact'
  backHref?: string | null
  backLabel?: string
}) {
  const nav = variant === 'full' ? (await loadSiteNav()).header.filter((i) => i.show) : []
  const link = (cls: string) => cls
  return (
    <header className="bg-white border-b border-gray-200" data-testid="site-header" data-variant={variant}>
      <div className="max-w-6xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between gap-4">
        <a href={MAIN_SITE} className="shrink-0 flex items-center" aria-label="Higher Ground Learning — home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/collateral/hgl-logo-color.png" alt="Higher Ground Learning" width={71} height={40} className="h-9 w-auto" />
        </a>
        {variant === 'compact' ? (
          backHref ? (
            <a href={backHref} className="text-sm font-semibold text-hgl-blue underline" data-testid="header-back">← {backLabel}</a>
          ) : null
        ) : (
          <>
            <nav className="hidden lg:flex items-center gap-4 text-[13px] font-semibold text-hgl-slate" aria-label="Site">
              {nav.map((it) => (
                <a
                  key={it.url + it.label}
                  href={it.url}
                  aria-current={it.key && it.key === current ? 'page' : undefined}
                  className={link(`hover:text-hgl-blue whitespace-nowrap ${it.key && it.key === current ? 'text-hgl-blue border-b-2 border-hgl-blue pb-0.5' : ''}`)}
                >
                  {it.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/inquire?source=header" className="hidden sm:inline-block bg-hgl-blue text-white text-[13px] font-bold px-3 py-1.5 rounded-md hover:opacity-90" data-testid="header-consult">
                Free Consultation
              </Link>
              <Link href="/login" className="text-[13px] font-semibold text-gray-500 hover:text-hgl-slate" data-testid="header-signin">
                Sign in
              </Link>
              {/* Mobile: the same items in a sheet — a no-JS <details>, so no layout shift. */}
              <details className="lg:hidden relative">
                <summary className="list-none cursor-pointer p-2 -mr-2 rounded hover:bg-gray-100" aria-label="Menu" data-testid="header-menu">
                  <span aria-hidden className="block w-5 h-0.5 bg-hgl-slate mb-1" />
                  <span aria-hidden className="block w-5 h-0.5 bg-hgl-slate mb-1" />
                  <span aria-hidden className="block w-5 h-0.5 bg-hgl-slate" />
                </summary>
                <nav className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-30" aria-label="Site (mobile)">
                  {nav.map((it) => (
                    <a
                      key={it.url + it.label}
                      href={it.url}
                      aria-current={it.key && it.key === current ? 'page' : undefined}
                      className={`block px-3 py-2 rounded text-sm font-semibold ${it.key && it.key === current ? 'text-hgl-blue bg-blue-50' : 'text-hgl-slate hover:bg-gray-50'}`}
                    >
                      {it.label}
                    </a>
                  ))}
                  <Link href="/inquire?source=header" className="block mt-1 px-3 py-2 rounded text-sm font-bold text-white bg-hgl-blue text-center">
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
