'use client'

import { TimezoneSelect } from '../admin/ui'
import type { AvailabilityRange } from '../utils/availability'

// PL-19 shared availability grid — the same component on the public intake
// form and the New Student Schedule wizard (spec §2/§3): per-weekday rows,
// one or more time ranges each, plus the family's timezone. Always optional;
// an empty grid means "unknown", never "unavailable".

const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function AvailabilityGrid({
  ranges,
  timezone,
  onChange,
  onTimezoneChange,
}: {
  ranges: AvailabilityRange[]
  timezone: string
  onChange: (ranges: AvailabilityRange[]) => void
  onTimezoneChange: (tz: string) => void
}) {
  const add = (weekday: number) =>
    onChange([...ranges, { weekday, start_time: '16:00', end_time: '18:00' }])
  const update = (idx: number, patch: Partial<AvailabilityRange>) =>
    onChange(ranges.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  const remove = (idx: number) => onChange(ranges.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-md">
        {WEEKDAY_LABELS.map((label, di) => {
          const weekday = di + 1
          const dayRanges = ranges
            .map((r, idx) => ({ r, idx }))
            .filter(({ r }) => r.weekday === weekday)
          return (
            <div key={weekday} className="flex items-start gap-3 px-3 py-2">
              <span className="w-24 shrink-0 pt-1 text-sm font-semibold text-gray-600">{label}</span>
              <div className="flex-1 space-y-1.5">
                {dayRanges.length === 0 && (
                  <span className="block pt-1 text-xs italic text-gray-400">—</span>
                )}
                {dayRanges.map(({ r, idx }) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={r.start_time}
                      onChange={(e) => e.target.value && update(idx, { start_time: e.target.value })}
                      className="border border-gray-300 rounded p-1.5 text-sm"
                    />
                    <span className="text-gray-400 text-sm">to</span>
                    <input
                      type="time"
                      value={r.end_time}
                      onChange={(e) => e.target.value && update(idx, { end_time: e.target.value })}
                      className="border border-gray-300 rounded p-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      className="text-xs text-gray-500 underline"
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => add(weekday)}
                className="shrink-0 pt-1 text-xs text-hgl-blue underline"
              >
                + add time
              </button>
            </div>
          )
        })}
      </div>
      <div>
        <label className="block text-xs text-gray-600 font-semibold mb-1">
          Your timezone (the times above are in it)
        </label>
        <TimezoneSelect value={timezone} onChange={onTimezoneChange} />
      </div>
    </div>
  )
}
