'use client'

import { useEffect, useState } from 'react'

// PL-395: the client half of the ONE attribution resolver (staff-names.ts).
// useStaffName() returns a label function: name ?? email — until the map
// arrives (or for an address no record knows) it renders the email, the
// honest fallback. Module-level cache: one fetch per page load however many
// panels resolve names.

type Names = Record<string, string>
let cached: Names | null = null
let inflight: Promise<Names> | null = null

async function loadNames(): Promise<Names> {
  if (cached) return cached
  inflight ??= fetch('/api/admin/staff-names')
    .then((r) => (r.ok ? r.json() : { names: {} }))
    .then((j) => {
      cached = (j.names ?? {}) as Names
      return cached
    })
    .catch(() => (cached = {}))
  return inflight
}

export function useStaffName(): (email: string | null | undefined) => string {
  const [map, setMap] = useState<Names | null>(cached)
  useEffect(() => {
    let live = true
    loadNames().then((m) => {
      if (live) setMap(m)
    })
    return () => {
      live = false
    }
  }, [])
  return (email) => {
    if (!email) return ''
    return map?.[email.toLowerCase()] ?? email
  }
}
