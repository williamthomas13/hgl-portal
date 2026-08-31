'use client'

// Visual session calendar — one row per session with a date chip, weekday,
// time, and location. Extracted from the registration page (SPEC v2.3 §12) so
// the Phase 4 portal views can reuse it read-only.
//
// PL-419: with `localTimes`, the FAMILY view converts each session to the
// browser's own timezone after mount ("your local time"), with the class-city
// time labeled alongside — never two unlabeled times. Server render and the
// first client paint keep the class-zone output exactly, so nothing flashes
// wrong and zones that match change nothing. Tutor/admin/counselor callers
// never pass `localTimes` (their working zone is the class's).

import { useEffect, useState, type ReactNode } from 'react'
import { bySessionStart, dateParts, formatTimeRange, publicTimeCityLabel } from '../utils/dates'
import { zonedToUtc } from '../utils/tutoring'

export type CalendarSession = {
  /** PL-277: present on admin surfaces so per-session actions can target rows. */
  id?: string
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

function fmtTime(t: string | null, hour24: boolean) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  if (hour24) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

export default function SessionCalendar({
  sessions,
  defaultLocation,
  calendarHref,
  hour24 = false,
  timezone = null,
  cityLabel = null,
  localTimes = false,
  renderActions,
}: {
  sessions: CalendarSession[]
  defaultLocation: string | null
  /** Link to the add-to-calendar / ICS-subscribe page; omit to hide the link. */
  calendarHref?: string
  /** 24-hour times (admin renders 24h; public keeps AM/PM). */
  hour24?: boolean
  /** PL-126: the class's IANA timezone — when set, a "(times shown in
   *  {city} time)" line renders so an international family never guesses. */
  timezone?: string | null
  /** PL-353: the resolved public city label ("Düsseldorf"). When set it wins
   *  over the location/zone fallback — callers with school-city data resolve
   *  via publicTimeCityLabel and pass the result. */
  cityLabel?: string | null
  /** PL-419: family view only — convert to the browser's zone post-mount
   *  when it differs from the class's, class-city time labeled alongside. */
  localTimes?: boolean
  /** PL-277: admin-only per-session actions (Edit/Remove) rendered at the
   *  row's right edge. Public and portal callers never pass this. */
  renderActions?: (s: CalendarSession) => ReactNode
}) {
  // The device zone resolves in useEffect so SSR and the hydration paint are
  // identical (class-zone render); the local swap happens only after mount.
  const [deviceTz, setDeviceTz] = useState<string | null>(null)
  useEffect(() => {
    if (!localTimes) return
    try {
      setDeviceTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null)
    } catch {}
  }, [localTimes])

  const sorted = [...sessions].sort(bySessionStart)
  if (sorted.length === 0) return null

  const resolvedCity =
    timezone ? cityLabel || publicTimeCityLabel({ location: defaultLocation, timezone }) : null
  const localized = Boolean(localTimes && timezone && deviceTz && deviceTz !== timezone)

  return (
    <div className="mb-4">
      <div className="grid grid-cols-1 gap-1.5">
        {sorted.map((s, i) => {
          // PL-419: in localized mode the date chip and weekday follow the
          // instant into the browser's zone too — a Rome evening class can be
          // the next calendar day for a family ahead of it.
          const instant =
            localized && s.start_time ? zonedToUtc(s.session_date, s.start_time.slice(0, 5), timezone!) : null
          const endInstant =
            instant && s.end_time ? zonedToUtc(s.session_date, s.end_time.slice(0, 5), timezone!) : null
          const d = instant
            ? dateParts(instant.toLocaleDateString('en-CA', { timeZone: deviceTz! }))
            : dateParts(s.session_date)
          const loc = s.location ?? defaultLocation
          const timeText = instant
            ? `${formatTimeRange(instant, endInstant, deviceTz!)} your time · ${formatTimeRange(instant, endInstant, timezone!)} in ${resolvedCity}`
            : fmtTime(s.start_time, hour24)
              ? `${fmtTime(s.start_time, hour24)}${s.end_time ? ` – ${fmtTime(s.end_time, hour24)}` : ''}`
              : 'Time TBD'
          return (
            <div
              key={s.session_date + i}
              className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm"
            >
              <div className="w-12 text-center shrink-0 bg-white border border-gray-200 rounded">
                <div className="text-[10px] font-bold text-hgl-blue uppercase leading-tight pt-0.5">
                  {d.monthShort}
                </div>
                <div className="text-base font-bold text-hgl-slate leading-tight pb-0.5">
                  {d.dayOfMonth}
                </div>
              </div>
              {/* PL-275: min-w-0 + break-words — a long meeting-link URL
                  must wrap, not push the page wide on mobile. */}
              <div className="min-w-0">
                <div className="font-semibold text-hgl-slate">
                  {d.weekdayLong}
                  <span className="text-gray-500 font-normal"> · Session {i + 1}</span>
                </div>
                <div className="text-gray-600 break-words [overflow-wrap:anywhere]">
                  {timeText}
                  {loc ? ` · ${loc}` : ''}
                </div>
              </div>
              {renderActions && <span className="ml-auto shrink-0">{renderActions(s)}</span>}
            </div>
          )
        })}
      </div>
      {timezone &&
        (localized ? (
          <p className="text-xs text-gray-500 mt-1.5">
            (times in your local time — the class itself runs on {resolvedCity} time)
          </p>
        ) : (
          /* PL-305/353/418: the class's own city — a caller-resolved label
             first (school city + display_cities via publicTimeCityLabel with
             the full class facts), then the ONE resolver over what this
             component holds (the location's city, the zone city last). */
          <p className="text-xs text-gray-500 mt-1.5">(times shown in {resolvedCity} time)</p>
        ))}
      {calendarHref && (
        /* PL-306: a new tab — mid-registration, following this link must
           never cost the parent their place or filled-in state. */
        <p className="text-sm mt-2">
          <a href={calendarHref} target="_blank" rel="noreferrer" className="text-hgl-blue underline font-semibold">
            Add to your calendar / subscribe →
          </a>
        </p>
      )}
    </div>
  )
}
