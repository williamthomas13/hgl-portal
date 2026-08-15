'use client'

import { useEffect } from 'react'

// PL-350: the class page's first-party counter. Counts three things, once
// per pageview each: the visit (+ whether it arrived via an hgl.co
// shortlink — the ?via tag PL-349 adds), which sections actually enter the
// viewport (IntersectionObserver over the page's [data-section] landmarks),
// and register-button clicks. Respects Do-Not-Track and Global Privacy
// Control by doing nothing at all. No cookies, no identifiers — the beacon
// body is the class id and metric names only.

export default function ClassPageAnalytics({ classId }: { classId: string }) {
  useEffect(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const nav = navigator as any
    if (nav.doNotTrack === '1' || (window as any).doNotTrack === '1' || nav.globalPrivacyControl) {
      return
    }
    const sent = new Set<string>()
    let queue: string[] = []
    let timer: ReturnType<typeof setTimeout> | null = null

    const flush = () => {
      if (queue.length === 0) return
      const body = JSON.stringify({ classId, metrics: queue })
      queue = []
      try {
        navigator.sendBeacon('/api/class-page-metrics', new Blob([body], { type: 'application/json' }))
      } catch {
        // counting is best-effort by design
      }
    }
    const track = (metric: string) => {
      if (sent.has(metric)) return
      sent.add(metric)
      queue.push(metric)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 1500)
    }

    track('visit')
    if (new URLSearchParams(window.location.search).has('via')) track('arrival:shortlink')

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const name = (e.target as HTMLElement).dataset.section
          if (e.isIntersecting && name) track(`section:${name}`)
        }
      },
      { threshold: 0.4 }
    )
    document.querySelectorAll('[data-section]').forEach((el) => io.observe(el))

    const onClick = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement).closest('[data-track="register"]')) {
        track('register-click')
        flush() // the click navigates away — don't wait for the timer
      }
    }
    document.addEventListener('click', onClick, true)
    const onHide = () => flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)

    return () => {
      io.disconnect()
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      if (timer) clearTimeout(timer)
      flush()
    }
  }, [classId])
  return null
}
