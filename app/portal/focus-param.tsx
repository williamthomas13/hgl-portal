'use client'
import { useEffect } from 'react'

/** PL-462: a portal page lands ON the item a link names — `?{param}={id}`
 *  scrolls to `#{prefix}{id}` and rings it (the admin pages' deep-link
 *  focus, for the portal's server-rendered views). */
export default function FocusParam({ param, prefix }: { param: string; prefix: string }) {
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(param)
    if (!id) return
    const node = document.getElementById(`${prefix}${id}`)
    if (!node) return
    node.scrollIntoView({ block: 'start', behavior: 'smooth' })
    node.classList.add('ring-2', 'ring-hgl-blue')
    const t = setTimeout(() => node.classList.remove('ring-2', 'ring-hgl-blue'), 9000)
    return () => clearTimeout(t)
  }, [param, prefix])
  return null
}
