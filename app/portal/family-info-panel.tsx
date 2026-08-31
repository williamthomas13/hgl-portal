'use client'

import { useState } from 'react'
import { pronounsDisplayLabel } from '../utils/pronoun-label'

// PL-422B: parent self-service — the family edits its own facts where it
// reads them, through the SAME write path staff use (/api/admin/family-facts,
// parent-scoped), so every surface updates identically. The parent EMAIL is
// the sign-in identity and deliberately not self-serve (v1: "contact us to
// change" — never an unverified swap). Students never get their own edit
// surface; this is the parent's login.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Option = { value: string; label: string }

function Row({
  label,
  value,
  display,
  options,
  multiline,
  onSave,
}: {
  label: string
  value: string | null
  /** What to show when not editing (defaults to the raw value). */
  display?: string | null
  options?: Option[]
  multiline?: boolean
  onSave: (next: string) => Promise<string | null>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  return (
    <div className="py-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="text-gray-500 w-40 shrink-0">{label}</span>
      {!editing ? (
        <>
          <span className="text-hgl-slate">{display ?? value ?? <span className="text-gray-400">not on file</span>}</span>
          <button
            onClick={() => {
              setDraft(value ?? '')
              setErr('')
              setEditing(true)
            }}
            className="text-[11px] text-gray-400 underline hover:text-hgl-blue"
          >
            edit
          </button>
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {options ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="border border-gray-300 rounded p-1 text-sm bg-white"
            >
              <option value="">—</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="border border-gray-300 rounded p-1.5 text-sm w-72 max-w-full"
            />
          ) : (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="border border-gray-300 rounded p-1 text-sm w-56 max-w-full"
            />
          )}
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              setErr('')
              const e = await onSave(draft)
              setSaving(false)
              if (e) setErr(e)
              else setEditing(false)
            }}
            className="text-xs font-bold text-white bg-hgl-blue rounded px-2.5 py-1 disabled:opacity-40"
          >
            Save
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-500 underline">
            cancel
          </button>
          {err && <span className="text-xs text-red-600 font-semibold basis-full">{err}</span>}
        </span>
      )}
    </div>
  )
}

export default function FamilyInfoPanel({
  family,
  intakeLead,
  students,
}: {
  family: { id: string; parent_first_name: string | null; parent_last_name: string | null; parent_email: string; parent_phone: string | null }
  intakeLead: { id: string; intake: any } | null
  students: { id: string; first_name: string; last_name: string; student_phone: string | null; pronouns: string | null; grade_level: string | null; special_needs: string | null }[]
}) {
  const save = async (body: Record<string, unknown>): Promise<string | null> => {
    try {
      const res = await fetch('/api/admin/family-facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return json.error ?? `The server returned ${res.status}.`
      // Server components re-render on refresh; the panel's own rows update
      // optimistically via the value the parent just typed.
      window.location.reload()
      return null
    } catch {
      return "Couldn't reach the server — check your connection."
    }
  }
  const intake = intakeLead?.intake ?? null

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-6">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">Your information</h2>
      <p className="text-xs text-gray-500 mb-4">
        Edits here update everywhere at once — our records, your tutor&apos;s view, and the emails we send.
      </p>

      <div className="divide-y divide-gray-100">
        <Row
          label="Parent name"
          value={`${family.parent_first_name ?? ''}`.trim() || null}
          display={`${family.parent_first_name ?? ''} ${family.parent_last_name ?? ''}`.trim() || null}
          onSave={async (next) => {
            const parts = next.trim().split(/\s+/)
            return save({
              action: 'update_parent',
              familyId: family.id,
              fields: { parent_first_name: parts[0] ?? '', parent_last_name: parts.slice(1).join(' ') },
            })
          }}
        />
        <Row
          label="Phone"
          value={family.parent_phone}
          onSave={(next) => save({ action: 'update_parent', familyId: family.id, fields: { parent_phone: next } })}
        />
        {/* PL-422 guardrail: the email is the sign-in identity — no
            unverified self-serve swap, ever. */}
        <div className="py-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-gray-500 w-40 shrink-0">Email</span>
          <span className="text-hgl-slate">{family.parent_email}</span>
          <span className="text-xs text-gray-400">
            — this is how you sign in; reply to any of our emails and we&apos;ll change it with you
          </span>
        </div>
        {intake ? (
          <>
            <Row
              label="Preferred contact"
              value={intake.preferredContactMethod ?? null}
              display={
                intake.preferredContactMethod === 'call'
                  ? 'Phone call'
                  : intake.preferredContactMethod === 'text'
                    ? 'Text message'
                    : intake.preferredContactMethod === 'email'
                      ? 'Email'
                      : null
              }
              options={[
                { value: 'call', label: 'Phone call' },
                { value: 'text', label: 'Text message' },
                { value: 'email', label: 'Email' },
              ]}
              onSave={(next) =>
                save({ action: 'update_intake', leadId: intakeLead!.id, fields: { preferredContactMethod: next } })
              }
            />
            <Row
              label="If they haven't arrived"
              value={intake.absentContactWho ?? null}
              display={
                intake.absentContactWho
                  ? `${intake.absentContactHow === 'text' ? 'Text' : 'Call'} the ${intake.absentContactWho === 'student' ? 'student' : 'parent'}`
                  : null
              }
              options={[
                { value: 'student|call', label: 'Call the student' },
                { value: 'student|text', label: 'Text the student' },
                { value: 'parent|call', label: 'Call the parent' },
                { value: 'parent|text', label: 'Text the parent' },
              ]}
              onSave={(next) => {
                const [who, how] = next.split('|')
                return save({
                  action: 'update_intake',
                  leadId: intakeLead!.id,
                  fields: { absentContactWho: who ?? '', absentContactHow: how ?? '' },
                })
              }}
            />
            <Row
              label="Emergency contact"
              value={intake.emergencyName ?? null}
              display={
                intake.emergencyName
                  ? `${intake.emergencyName}${intake.emergencyRelation ? ` (${intake.emergencyRelation})` : ''}${intake.emergencyPhone ? ` · ${intake.emergencyPhone}` : ''}`
                  : null
              }
              onSave={(next) => save({ action: 'update_intake', leadId: intakeLead!.id, fields: { emergencyName: next } })}
            />
            {intake.emergencyName && (
              <>
                <Row
                  label="Emergency phone"
                  value={intake.emergencyPhone ?? null}
                  onSave={(next) => save({ action: 'update_intake', leadId: intakeLead!.id, fields: { emergencyPhone: next } })}
                />
                <Row
                  label="Emergency relation"
                  value={intake.emergencyRelation ?? null}
                  onSave={(next) =>
                    save({ action: 'update_intake', leadId: intakeLead!.id, fields: { emergencyRelation: next } })
                  }
                />
              </>
            )}
          </>
        ) : (
          <p className="py-2 text-xs text-gray-500">
            Contact preference, emergency contact and arrival instructions get captured on the intake
            form — if you&apos;d like to add them, just reply to any of our emails.
          </p>
        )}
      </div>

      {students.map((st) => (
        <div key={st.id} className="mt-4">
          <h3 className="font-semibold text-hgl-slate text-sm mb-1">
            {st.first_name} {st.last_name}
          </h3>
          <div className="divide-y divide-gray-100">
            <Row
              label="Phone"
              value={st.student_phone}
              onSave={(next) => save({ action: 'update_student', studentId: st.id, fields: { student_phone: next } })}
            />
            <Row
              label="Pronouns"
              value={st.pronouns}
              display={st.pronouns ? pronounsDisplayLabel(st.pronouns) : null}
              options={[
                { value: 'she_her', label: 'she/her' },
                { value: 'he_him', label: 'he/him' },
                { value: 'they_them', label: 'they/them' },
                { value: 'name_only', label: `use ${st.first_name}'s name only` },
              ]}
              onSave={(next) => save({ action: 'update_student', studentId: st.id, fields: { pronouns: next } })}
            />
            <Row
              label="Grade"
              value={st.grade_level}
              onSave={(next) => save({ action: 'update_student', studentId: st.id, fields: { grade_level: next } })}
            />
            <Row
              label="Learning notes"
              value={st.special_needs}
              multiline
              onSave={(next) => save({ action: 'update_student', studentId: st.id, fields: { special_needs: next } })}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
