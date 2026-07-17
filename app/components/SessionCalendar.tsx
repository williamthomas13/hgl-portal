// Visual session calendar — one row per session with a date chip, weekday,
// time, and location. Extracted from the registration page (SPEC v2.3 §12) so
// the Phase 4 portal views can reuse it read-only. Pure presentational: no
// hooks, renders in server and client components alike.

import { bySessionStart, dateParts } from '../utils/dates'

export type CalendarSession = {
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
}: {
  sessions: CalendarSession[]
  defaultLocation: string | null
  /** Link to the add-to-calendar / ICS-subscribe page; omit to hide the link. */
  calendarHref?: string
  /** 24-hour times (admin renders 24h; public keeps AM/PM). */
  hour24?: boolean
}) {
  const sorted = [...sessions].sort(bySessionStart)
  if (sorted.length === 0) return null

  return (
    <div className="mb-4">
      <div className="grid grid-cols-1 gap-1.5">
        {sorted.map((s, i) => {
          const d = dateParts(s.session_date)
          const loc = s.location ?? defaultLocation
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
              <div>
                <div className="font-semibold text-hgl-slate">
                  {d.weekdayLong}
                  <span className="text-gray-500 font-normal"> · Session {i + 1}</span>
                </div>
                <div className="text-gray-600">
                  {fmtTime(s.start_time, hour24)
                    ? `${fmtTime(s.start_time, hour24)}${s.end_time ? ` – ${fmtTime(s.end_time, hour24)}` : ''}`
                    : 'Time TBD'}
                  {loc ? ` · ${loc}` : ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {calendarHref && (
        <p className="text-sm mt-2">
          <a href={calendarHref} className="text-hgl-blue underline font-semibold">
            Add to your calendar / subscribe →
          </a>
        </p>
      )}
    </div>
  )
}
