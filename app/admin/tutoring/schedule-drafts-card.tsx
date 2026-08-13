'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { CollapsibleSection } from '../ui'
import { ConfirmAction } from './confirm'
import { WEEKDAYS, type Tutor } from './types'
import type { ScheduleDraftRow } from './engagement-wizard'

// PL-338 C: "Schedules in progress" — one row per saved draft: student (or
// "no student yet"), tutor, slot summary, age, Resume / Discard. Names are
// doors. Renders nothing when no drafts exist (state-driven, like the
// dashboard's generic count row).

/** 'HH:MM' → "4:00 PM". */
function fmtHHMM(hhmm: string): string {
  const [h, m] = (hhmm ?? '').split(':').map(Number)
  if (Number.isNaN(h)) return hhmm
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function slotSummary(d: ScheduleDraftRow): string {
  const slots = d.payload?.slots ?? []
  if (slots.length === 0) return 'no weekly times yet'
  return slots
    .map((s) => `${WEEKDAYS[(s.weekday ?? 1) - 1]} ${fmtHHMM(s.start_time)} · ${s.duration_minutes} min`)
    .join(' + ')
}

const startedLabel = (iso: string) =>
  `started ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

export default function ScheduleDraftsCard({
  version,
  tutors,
  onResume,
}: {
  /** Bumped by the wizard on save/discard/create — triggers a recount. */
  version: number
  tutors: Tutor[]
  onResume: (draft: ScheduleDraftRow) => void
}) {
  const [rows, setRows] = useState<ScheduleDraftRow[]>([])
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('tutoring_schedule_drafts')
      .select('id, created_by, student_label, payload, created_at, updated_at')
      .order('updated_at', { ascending: false })
    setRows((data as ScheduleDraftRow[]) ?? [])
  }, [])
  useEffect(() => {
    load()
  }, [load, version])

  async function discard(id: string) {
    const { error } = await supabase.from('tutoring_schedule_drafts').delete().eq('id', id)
    if (error) setMessage('Error: the draft did not delete — ' + error.message)
    else {
      setMessage('Draft discarded.')
      load()
    }
  }

  if (rows.length === 0) return null
  return (
    <div className="mt-6">
      <CollapsibleSection
        title="Schedules in progress"
        subtitle={`${rows.length} saved draft${rows.length === 1 ? '' : 's'} — resume where you left off`}
        accent="border-amber-400"
        defaultOpen
      >
        <div className="space-y-2 text-sm">
          {rows.map((d) => {
            const tutor = tutors.find((t) => t.id === d.payload?.tutorId)
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-gray-200 bg-gray-50 p-3">
                <span className="font-semibold text-hgl-slate">
                  {d.student_label ?? 'no student yet'}
                </span>
                <span className="text-xs text-gray-600">
                  {tutor?.name ?? tutor?.email ?? 'no tutor yet'} · {slotSummary(d)}
                </span>
                <span className="text-xs text-gray-400">
                  {startedLabel(d.created_at)} · {d.created_by.split('@')[0]}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <button
                    onClick={() => onResume(d)}
                    className="bg-hgl-slate text-white text-xs font-bold py-1.5 px-3 rounded hover:opacity-90"
                  >
                    Resume
                  </button>
                  <ConfirmAction
                    label="Discard"
                    message={`Throw away ${d.student_label ? `${d.student_label}'s` : 'this'} draft? Nothing was ever created from it.`}
                    confirmLabel="Yes, discard"
                    className="text-xs text-gray-500 underline"
                    onConfirm={() => discard(d.id)}
                  />
                </span>
              </div>
            )
          })}
          {message && (
            <p className={`text-xs font-semibold ${message.startsWith('Error') ? 'text-red-700' : 'text-gray-500'}`}>
              {message}
            </p>
          )}
        </div>
      </CollapsibleSection>
    </div>
  )
}
