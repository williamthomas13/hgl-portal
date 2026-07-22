'use client'

import { useEffect, useState } from 'react'
import AvailabilityGrid from '../../components/AvailabilityGrid'
import type { AvailabilityRange } from '../../utils/availability'

// Phase 7e intake form (spec §11): one page, clear sections, no login. The
// §11 field list verbatim — student, guardian(s), contact preferences,
// emergency contact, background, test-prep-vs-subject specifics,
// availability, online/in-person preference.

export type IntakePrefill = {
  studentFirst: string
  studentLast: string
  school: string
  grade: string
  guardianFirst: string
  guardianLast: string
  guardianEmail: string
  guardianPhone: string
  interest: 'test_prep' | 'subject'
  subjects: string
  testDate: string
  priorScores: string
  availabilityText: string
  onlinePreference: string
}

const inputCls = 'block w-full border border-gray-300 rounded-md p-2'
const labelCls = 'block text-sm font-semibold text-gray-700 mb-1'

function Field({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}

function SectionTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="border-b border-gray-100 pb-1 mt-8 mb-4 first:mt-0">
      <h2 className="text-lg font-bold text-hgl-slate">
        {n}. {title}
      </h2>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export default function IntakeForm({ token, prefill }: { token: string; prefill: IntakePrefill }) {
  const [f, setF] = useState({
    studentFirst: prefill.studentFirst,
    pronouns: '',
    studentLast: prefill.studentLast,
    studentPhone: '',
    studentEmail: '',
    school: prefill.school,
    grade: prefill.grade,
    guardianFirst: prefill.guardianFirst,
    guardianLast: prefill.guardianLast,
    guardianPhone: prefill.guardianPhone,
    guardianEmail: prefill.guardianEmail,
    guardian2Name: '',
    guardian2Phone: '',
    guardian2Email: '',
    preferredContactMethod: '',
    absentContactWho: '',
    absentContactHow: '',
    emergencyName: '',
    emergencyPhone: '',
    emergencyRelation: '',
    howHeard: '',
    reason: '',
    specialNeeds: '',
    interest: prefill.interest as string,
    testDate: prefill.testDate,
    priorScores: prefill.priorScores,
    subjects: prefill.subjects,
    availabilityText: prefill.availabilityText,
    onlinePreference: prefill.onlinePreference,
  })
  const [availability, setAvailability] = useState<AvailabilityRange[]>([])
  const [availabilityTimezone, setAvailabilityTimezone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Default the timezone from the browser after mount (SSR has no browser
  // zone to read, and a mismatched select would break hydration).
  useEffect(() => {
    setAvailabilityTimezone((tz) => tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver')
  }, [])

  const set = (k: keyof typeof f) => (v: string) => setF((prev) => ({ ...prev, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const badRange = availability.some((r) => r.end_time <= r.start_time)
    if (badRange) {
      setError('One of the availability times ends before it starts — fix or remove that row and resend.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...f, availability, availabilityTimezone }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again.')
        return
      }
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('Something went wrong — please try again, or just give us a call.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
        <strong>All set — thank you!</strong> We have everything we need. We&apos;ll be in touch
        shortly with next steps; nothing more to do on your end.
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SectionTitle n={1} title="The student" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="First name" required>
          <input className={inputCls} required value={f.studentFirst} onChange={(e) => set('studentFirst')(e.target.value)} />
        </Field>
        <Field label="Last name" required>
          <input className={inputCls} required value={f.studentLast} onChange={(e) => set('studentLast')(e.target.value)} />
        </Field>
        <Field label="Student phone">
          <input className={inputCls} type="tel" value={f.studentPhone} onChange={(e) => set('studentPhone')(e.target.value)} />
        </Field>
        <Field label="Student email">
          <input className={inputCls} type="email" value={f.studentEmail} onChange={(e) => set('studentEmail')(e.target.value)} />
        </Field>
        <Field label="School">
          <input className={inputCls} value={f.school} onChange={(e) => set('school')(e.target.value)} />
        </Field>
        <Field label="Grade">
          <input className={inputCls} placeholder="e.g. 11th" value={f.grade} onChange={(e) => set('grade')(e.target.value)} />
        </Field>
        {/* PL-69: optional, no explanatory text; unset keeps neutral wording. */}
        <Field label={`${f.studentFirst.trim() || "Student"}'s pronouns`}>
          <select className={inputCls} value={f.pronouns} onChange={(e) => set('pronouns')(e.target.value)}>
            <option value=""></option>
            <option value="she_her">she/her</option>
            <option value="he_him">he/him</option>
            <option value="they_them">they/them</option>
            {/* PL-80: renders the student's name where a pronoun would go. */}
            <option value="name_only">Something else / rather not say</option>
          </select>
        </Field>
      </div>

      <SectionTitle n={2} title="Parent / guardian" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="First name" required>
          <input className={inputCls} required value={f.guardianFirst} onChange={(e) => set('guardianFirst')(e.target.value)} />
        </Field>
        <Field label="Last name" required>
          <input className={inputCls} required value={f.guardianLast} onChange={(e) => set('guardianLast')(e.target.value)} />
        </Field>
        <Field label="Phone" required>
          <input className={inputCls} type="tel" required value={f.guardianPhone} onChange={(e) => set('guardianPhone')(e.target.value)} />
        </Field>
        <Field label="Email" required>
          <input className={inputCls} type="email" required value={f.guardianEmail} onChange={(e) => set('guardianEmail')(e.target.value)} />
        </Field>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-hgl-blue font-semibold">
          Add a second parent / guardian (optional)
        </summary>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
          <Field label="Name">
            <input className={inputCls} value={f.guardian2Name} onChange={(e) => set('guardian2Name')(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} type="tel" value={f.guardian2Phone} onChange={(e) => set('guardian2Phone')(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className={inputCls} type="email" value={f.guardian2Email} onChange={(e) => set('guardian2Email')(e.target.value)} />
          </Field>
        </div>
      </details>

      <SectionTitle n={3} title="Keeping in touch" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Best way to reach you">
          <select className={`${inputCls} bg-white`} value={f.preferredContactMethod} onChange={(e) => set('preferredContactMethod')(e.target.value)}>
            <option value="">Pick one…</option>
            <option value="call">Phone call</option>
            <option value="text">Text</option>
            <option value="email">Email</option>
          </select>
        </Field>
        <Field label="If the student hasn't arrived, contact…">
          <select className={`${inputCls} bg-white`} value={f.absentContactWho} onChange={(e) => set('absentContactWho')(e.target.value)}>
            <option value="">Pick one…</option>
            <option value="student">The student</option>
            <option value="parent">The parent</option>
          </select>
        </Field>
        <Field label="…by">
          <select className={`${inputCls} bg-white`} value={f.absentContactHow} onChange={(e) => set('absentContactHow')(e.target.value)}>
            <option value="">Pick one…</option>
            <option value="call">Phone call</option>
            <option value="text">Text</option>
          </select>
        </Field>
      </div>

      <SectionTitle n={4} title="Emergency contact" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Name" required>
          <input className={inputCls} required value={f.emergencyName} onChange={(e) => set('emergencyName')(e.target.value)} />
        </Field>
        <Field label="Phone number" required>
          <input className={inputCls} type="tel" required value={f.emergencyPhone} onChange={(e) => set('emergencyPhone')(e.target.value)} />
        </Field>
        <Field label="Relation to the student" required>
          <input className={inputCls} required placeholder="e.g. mother, uncle" value={f.emergencyRelation} onChange={(e) => set('emergencyRelation')(e.target.value)} />
        </Field>
      </div>

      <SectionTitle n={5} title="A little background" />
      <div className="space-y-4">
        <Field label="How did you hear about Higher Ground Learning?">
          <input className={inputCls} value={f.howHeard} onChange={(e) => set('howHeard')(e.target.value)} />
        </Field>
        <Field label="What brings you to us? What should tutoring accomplish?">
          <textarea className={inputCls} rows={3} value={f.reason} onChange={(e) => set('reason')(e.target.value)} />
        </Field>
        <Field label="Anything we should know? (learning differences, allergies, accommodations…)">
          <textarea className={inputCls} rows={2} value={f.specialNeeds} onChange={(e) => set('specialNeeds')(e.target.value)} />
        </Field>
      </div>

      <SectionTitle n={6} title="What we'll work on" />
      <div className="flex gap-6 text-sm mb-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="interest" checked={f.interest === 'test_prep'} onChange={() => set('interest')('test_prep')} />
          Test prep (SAT, ACT, GRE…)
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="interest" checked={f.interest === 'subject'} onChange={() => set('interest')('subject')} />
          Help in a school subject
        </label>
      </div>
      {f.interest === 'test_prep' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Which test, and when?">
            <input className={inputCls} placeholder="e.g. SAT in March" value={f.testDate} onChange={(e) => set('testDate')(e.target.value)} />
          </Field>
          <Field label="Any previous scores? (real or practice)">
            <input className={inputCls} placeholder="e.g. PSAT 1180" value={f.priorScores} onChange={(e) => set('priorScores')(e.target.value)} />
          </Field>
        </div>
      ) : (
        <Field label="Which subject(s)?">
          <input className={inputCls} placeholder="e.g. Algebra 2, AP Chemistry" value={f.subjects} onChange={(e) => set('subjects')(e.target.value)} />
        </Field>
      )}

      <SectionTitle
        n={7}
        title="Scheduling"
        hint="We match on availability first — the more you give us here, the faster we can propose times."
      />
      <div className="space-y-4">
        <div>
          <label className={labelCls}>
            When is {f.studentFirst.trim() || 'the student'} usually free for tutoring?
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Rough is fine — we&apos;ll confirm exact times with you. Skip this if you&apos;d rather
            talk it through by phone.
          </p>
          <AvailabilityGrid
            ranges={availability}
            timezone={availabilityTimezone}
            onChange={setAvailability}
            onTimezoneChange={setAvailabilityTimezone}
          />
        </div>
        <Field label="Anything else about scheduling?">
          <textarea
            className={inputCls}
            rows={2}
            placeholder={'e.g. soccer practice ends in November, weekends flexible'}
            value={f.availabilityText}
            onChange={(e) => set('availabilityText')(e.target.value)}
          />
        </Field>
        <Field label="Online or in person?" required>
          <select className={`${inputCls} bg-white`} required value={f.onlinePreference} onChange={(e) => set('onlinePreference')(e.target.value)}>
            <option value="">Pick one…</option>
            <option value="online">Online</option>
            <option value="in_person">In person</option>
            <option value="either">Either works</option>
          </select>
        </Field>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50"
      >
        {saving ? 'Sending…' : 'Send it in'}
      </button>
      <p className="text-xs text-gray-400 text-center">
        Your answers go straight to our team — nothing is shared or published.
      </p>
    </form>
  )
}
