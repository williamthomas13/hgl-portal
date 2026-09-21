'use client'

import { useEffect, useRef } from 'react'

// PL-473/477: the full-page versions of the embeddable forms render the SAME
// script the Squarespace snippet loads — one form, one set of fields, one
// API — so the page and the embed can never drift.
export default function PublicEmbedForm({ script, mountId, source, interest }: { script: string; mountId: string; source: string | null; interest: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const s = document.createElement('script')
    s.src = script
    s.async = true
    document.body.appendChild(s)
    return () => {
      s.remove()
    }
  }, [script])
  return <div ref={ref} id={mountId} data-source={source ?? undefined} data-interest={interest ?? undefined} />
}
