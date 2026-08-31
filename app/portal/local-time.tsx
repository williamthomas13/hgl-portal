'use client'

// PL-419: family-portal instants rendered in the BROWSER's own timezone.
// Server render (and the hydration paint) use the fallback zone — the
// family/tutor zone the surface always showed — so nothing flashes wrong;
// after mount, a device in a different zone swaps to its own clock. Tutor
// and admin surfaces never use these (their working zone is their own).

import { useEffect, useState } from 'react'
import { formatTimeRange, staffTimeCityLabel } from '../utils/dates'

export function useDeviceTimezone(): string | null {
  const [tz, setTz] = useState<string | null>(null)
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null)
    } catch {}
  }, [])
  return tz
}

/** "Wed, Sep 2" — the instant's date in the device zone (fallback first). */
export function LocalDay({ iso, tz }: { iso: string; tz: string }) {
  const deviceTz = useDeviceTimezone()
  return (
    <>
      {new Date(iso).toLocaleDateString('en-US', {
        timeZone: deviceTz ?? tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })}
    </>
  )
}

/** "4:00–5:30 PM" — the instant range in the device zone (fallback first). */
export function LocalTimeRange({
  startIso,
  endIso,
  tz,
}: {
  startIso: string
  endIso?: string | null
  tz: string
}) {
  const deviceTz = useDeviceTimezone()
  return <>{formatTimeRange(startIso, endIso, deviceTz ?? tz)}</>
}

/** The tutoring card's zone note — honest in both states: the fallback-zone
 *  label until the device zone is known or when it matches, "your local
 *  time" once a differing device zone takes over (weekly patterns keep the
 *  tutor's wall clock, so they stay named). */
export function LocalZoneNote({ tz }: { tz: string }) {
  const deviceTz = useDeviceTimezone()
  if (deviceTz && deviceTz !== tz) {
    return (
      <>
        Session times are in your local time. Weekly patterns are listed in{' '}
        {staffTimeCityLabel(tz)} time.
      </>
    )
  }
  return <>Times shown in {staffTimeCityLabel(tz)} time.</>
}
