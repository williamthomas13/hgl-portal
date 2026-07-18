'use client'

import { useEffect, useState } from 'react'
import AvailabilityGrid from '../../components/AvailabilityGrid'
import type { AvailabilityRange } from '../../utils/availability'

// PL-53b client form: one grid per student (families usually have one),
// saved per student. Same grid component as intake and the wizard.

type StudentInit = {
  id: string
  firstName: string
  ranges: AvailabilityRange[]
  timezone: string | null
}

export default function AvailabilityShareForm({
  token,
  students,
}: {
  token: string
  students: StudentInit[]
}) {
  const [state, setState] = useState(() =>
    students.map((s) => ({ ...s, timezone: s.timezone ?? '', saving: false, message: '' }))
  )

  // Browser-default timezone after mount (SSR has none to read).
  useEffect(() => {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver'
    setState((prev) => prev.map((s) => ({ ...s, timezone: s.timezone || browserTz })))
  }, [])

  const patch = (id: string, p: Partial<(typeof state)[number]>) =>
    setState((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)))

  async function save(s: (typeof state)[number]) {
    if (s.ranges.some((r) => r.end_time <= r.start_time)) {
      patch(s.id, { message: 'Error: one of the ranges ends before it starts — fix or remove it first.' })
      return
    }
    patch(s.id, { saving: true, message: '' })
    try {
      const res = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, studentId: s.id, availability: s.ranges, timezone: s.timezone }),
      })
      const json = await res.json()
      patch(s.id, {
        saving: false,
        message: res.ok
          ? "Saved — we'll be in touch with proposed times."
          : 'Error: ' + (json.error ?? 'something went wrong — please try again.'),
      })
    } catch {
      patch(s.id, { saving: false, message: 'Error: something went wrong — please try again.' })
    }
  }

  return (
    <div className="space-y-8">
      {state.map((s) => (
        <div key={s.id}>
          {state.length > 1 && (
            <h2 className="text-lg font-bold text-hgl-slate mb-2">{s.firstName}</h2>
          )}
          <AvailabilityGrid
            ranges={s.ranges}
            timezone={s.timezone}
            onChange={(ranges) => patch(s.id, { ranges, message: '' })}
            onTimezoneChange={(timezone) => patch(s.id, { timezone, message: '' })}
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => save(s)}
              disabled={s.saving}
              className="bg-hgl-blue text-white font-bold py-2 px-5 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50"
            >
              {s.saving ? 'Saving…' : state.length > 1 ? `Save ${s.firstName}'s availability` : 'Save availability'}
            </button>
            {s.message && (
              <span className={`text-sm ${s.message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
                {s.message}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
