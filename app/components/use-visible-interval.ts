'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * PL-152: an interval that only fires while its panel is actually on screen.
 *
 * The PL-101 sidebar hides sections with `display:none` instead of
 * unmounting them (deliberately — the PL-99 late-mount lesson), so every
 * mounted panel's timer kept running from every other tab: each class card
 * polled attendance every 20 seconds, forever, including every card under
 * "Past & cancelled". The work is skipped when the panel is hidden (a
 * `display:none` ancestor makes offsetParent null) or the browser tab is in
 * the background, and one immediate catch-up runs on the way back so the
 * panel is never stale when someone returns to it.
 *
 * Pass the ref through to the panel's own root element.
 */
export function useVisibleInterval(
  ref: RefObject<HTMLElement | null>,
  fn: () => void,
  ms: number,
  enabled = true
) {
  // Keep the latest callback without restarting the timer on every render.
  const saved = useRef(fn)
  useEffect(() => {
    saved.current = fn
  }, [fn])

  useEffect(() => {
    if (!enabled) return
    const onScreen = () =>
      typeof document !== 'undefined' &&
      !document.hidden &&
      // offsetParent is null when the element (or an ancestor) is display:none.
      ref.current?.offsetParent != null

    const timer = setInterval(() => {
      if (onScreen()) saved.current()
    }, ms)

    // Coming back to the tab shouldn't wait out a full interval.
    const onVisibility = () => {
      if (onScreen()) saved.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ref, ms, enabled])
}
