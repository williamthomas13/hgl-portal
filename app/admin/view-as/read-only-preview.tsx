'use client'

import type { ReactNode } from 'react'

// PL-325: THE read-only rule for view-as, one place, every role.
// Blanket pointer-events-none killed harmless clicks (expanders, copy
// buttons, downloads, the performance-report link). Now a capture-phase
// interceptor decides per interaction:
//   ALLOWED  — <details>/<summary> expanders · elements marked
//              [data-viewas-safe] (copy-to-clipboard) · downloads
//              (a[download]) · read-only links (target=_blank, the class
//              report, collateral/PDF/ICS endpoints) — these open in a NEW
//              TAB stamped ?viewas=1, so the preview page itself never
//              navigates away.
//   BLOCKED  — everything else: buttons, form submits, in-page navigation —
//              every path that could mutate.

const READ_ONLY_LINK = /^\/(class-report\/|api\/classes\/|api\/receipts\/|classes\/)/

function stamp(href: string): string {
  if (href.startsWith('http') || href.startsWith('#')) return href
  return href + (href.includes('?') ? '&' : '?') + 'viewas=1'
}

export default function ReadOnlyPreview({ children }: { children: ReactNode }) {
  const onClickCapture = (ev: React.MouseEvent) => {
    const t = ev.target as Element
    // Expanders/collapsers are pure UI state.
    if (t.closest('summary')) return
    // Explicitly-marked safe controls (CopyButton — clipboard only).
    if (t.closest('[data-viewas-safe]')) return
    const a = t.closest('a[href]') as HTMLAnchorElement | null
    if (a) {
      const href = a.getAttribute('href') ?? ''
      const readOnly =
        a.hasAttribute('download') || a.target === '_blank' || READ_ONLY_LINK.test(href)
      if (readOnly && href && !href.startsWith('#')) {
        ev.preventDefault()
        ev.stopPropagation()
        window.open(stamp(href), '_blank', 'noopener')
        return
      }
    }
    // Everything else — buttons, submits, in-page links — is a potential
    // mutation or a navigation out of the preview. Blocked.
    ev.preventDefault()
    ev.stopPropagation()
  }
  const onSubmitCapture = (ev: React.FormEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
  }
  return (
    <div
      onClickCapture={onClickCapture}
      onSubmitCapture={onSubmitCapture}
      className="select-text"
      aria-label="Read-only preview — mutations blocked, read-only interactions allowed"
    >
      {children}
    </div>
  )
}
