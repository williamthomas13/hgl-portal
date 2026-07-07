'use client'

import { useState } from 'react'
import { supabase } from '../utils/supabase'
import SessionCalendar from '../components/SessionCalendar'
import { formatDateAdmin, addDays, monthYear } from '../utils/dates'
import { TimeSelect } from './ui'
import type { Instructor } from './instructors-panel'

// Class creation wizard (admin UX addendum): details → sessions → review.
// Cannot complete with zero sessions; the class's start_date derives from the
// earliest session. School / contact / instructor are strict selects with
// explicit "+ Add new" actions — no free text, no find-or-create-by-typo.
// Each new session form pre-fills from the previous session (same times and
// location, date advanced a week — the weekly-cadence default).

export type School = {
  id: string
  name: string
  nickname: string
  timezone: string
}

export type ContactAtSchool = {
  id: string // contact id (what classes.counselor_id stores)
  school_id: string
  first_name: string
  last_name: string
  email: string
}

type SessionDraft = {
  session_date: string
  start_time: string // '' or 'HH:MM'
  end_time: string
  location: string
}

const COMMON_TIMEZONES = [
  'America/Mexico_City',
  'America/Santiago',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
]

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Season+year term from the start date, e.g. "fall26". */
function termFor(startDate: string) {
  const { month: m, year } = monthYear(startDate)
  const season = m <= 4 ? 'spring' : m <= 7 ? 'summer' : m <= 10 ? 'fall' : 'winter'
  return `${season}${String(year).slice(-2)}`
}

const inputCls =
  'mt-1 block w-full border border-gray-300 rounded-md p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition'
const selectCls = inputCls + ' bg-white'

export default function ClassWizard({
  schools,
  contacts,
  instructors,
  onSchoolsChange,
  onContactsChange,
  onInstructorsChange,
  onCreated,
}: {
  schools: School[]
  contacts: ContactAtSchool[]
  instructors: Instructor[]
  onSchoolsChange: () => void
  onContactsChange: () => void
  onInstructorsChange: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // -- step 1: details ------------------------------------------------------
  const [schoolId, setSchoolId] = useState('')
  const [counselorId, setCounselorId] = useState('') // '' = all school contacts
  const [classType, setClassType] = useState('')
  const [instructorId, setInstructorId] = useState('')
  const [price, setPrice] = useState('')
  const [capacity, setCapacity] = useState('')
  const [deliveryMode, setDeliveryMode] = useState<'in_person' | 'online'>('in_person')
  const [minEnrollment, setMinEnrollment] = useState('8')
  const [enrollmentDeadline, setEnrollmentDeadline] = useState('')
  const [registrationClose, setRegistrationClose] = useState('')
  const [synapGroup, setSynapGroup] = useState('')
  const [defaultLocation, setDefaultLocation] = useState('')

  // -- step 2: sessions ------------------------------------------------------
  const [sessions, setSessions] = useState<SessionDraft[]>([])
  const [draft, setDraft] = useState<SessionDraft>({
    session_date: '',
    start_time: '',
    end_time: '',
    location: '',
  })

  const school = schools.find((s) => s.id === schoolId) ?? null
  const instructor = instructors.find((i) => i.id === instructorId) ?? null
  const schoolContacts = contacts.filter((c) => c.school_id === schoolId)
  const sorted = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date))
  const startDate = sorted[0]?.session_date ?? ''

  // -- "+ Add new" inline creators ------------------------------------------
  const [addingSchool, setAddingSchool] = useState(false)
  const [newSchool, setNewSchool] = useState({ nickname: '', name: '', timezone: COMMON_TIMEZONES[0] })
  const [addingContact, setAddingContact] = useState(false)
  const [newContact, setNewContact] = useState({ first_name: '', last_name: '', email: '' })
  const [addingInstructor, setAddingInstructor] = useState(false)
  const [newInstructor, setNewInstructor] = useState({ name: '', email: '', default_meeting_link: '' })

  async function saveNewSchool() {
    const nickname = newSchool.nickname.trim()
    if (!nickname) return
    const { data, error } = await supabase
      .from('schools')
      .insert([
        {
          nickname,
          name: newSchool.name.trim() || nickname,
          timezone: newSchool.timezone,
        },
      ])
      .select('id')
      .single()
    if (error || !data) {
      setMessage(
        'Error adding school: ' +
          (error?.code === '23505' ? 'that nickname already exists.' : (error?.message ?? 'unknown'))
      )
      return
    }
    setMessage('')
    onSchoolsChange()
    setSchoolId(data.id)
    setAddingSchool(false)
    setNewSchool({ nickname: '', name: '', timezone: COMMON_TIMEZONES[0] })
  }

  async function saveNewContact() {
    if (!schoolId) return
    const email = newContact.email.trim().toLowerCase()
    if (!email) return
    // Find-or-create the person, then open an affiliation at this school.
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .ilike('email', email)
      .maybeSingle()
    let contactId = existing?.id as string | undefined
    if (!contactId) {
      const { data: created, error } = await supabase
        .from('contacts')
        .insert([
          {
            first_name: newContact.first_name.trim(),
            last_name: newContact.last_name.trim(),
            email,
          },
        ])
        .select('id')
        .single()
      if (error || !created) {
        setMessage('Error adding contact: ' + (error?.message ?? 'unknown'))
        return
      }
      contactId = created.id
    }
    if (!contacts.some((c) => c.id === contactId && c.school_id === schoolId)) {
      const { error: affErr } = await supabase
        .from('school_affiliations')
        .insert([{ contact_id: contactId, school_id: schoolId, role: 'counselor' }])
      if (affErr) {
        setMessage('Error adding affiliation: ' + affErr.message)
        return
      }
    }
    setMessage('')
    onContactsChange()
    setCounselorId(contactId!)
    setAddingContact(false)
    setNewContact({ first_name: '', last_name: '', email: '' })
  }

  async function saveNewInstructor() {
    const email = newInstructor.email.trim().toLowerCase()
    if (!email) return
    const { data, error } = await supabase
      .from('instructors')
      .insert([
        {
          email,
          name: newInstructor.name.trim() || null,
          default_meeting_link: newInstructor.default_meeting_link.trim() || null,
        },
      ])
      .select('id')
      .single()
    if (error || !data) {
      setMessage(
        'Error adding instructor: ' +
          (error?.code === '23505'
            ? 'that email is already an instructor — pick them from the list.'
            : (error?.message ?? 'unknown'))
      )
      return
    }
    setMessage('')
    onInstructorsChange()
    setInstructorId(data.id)
    setAddingInstructor(false)
    setNewInstructor({ name: '', email: '', default_meeting_link: '' })
  }

  // -- session drafts --------------------------------------------------------
  function addSession() {
    if (!draft.session_date) return
    setSessions((prev) => [...prev, draft])
    // Pre-fill the next form from this session: same times and location,
    // date advanced a week (weekly cadence is the norm; still editable).
    setDraft({ ...draft, session_date: addDays(draft.session_date, 7) })
  }

  function removeSession(idx: number) {
    setSessions((prev) => prev.filter((_, i) => i !== idx))
  }

  // -- create ----------------------------------------------------------------
  const detailsComplete = Boolean(schoolId && classType.trim() && instructorId && price && capacity)

  async function handleCreate() {
    if (!school || !instructor || sessions.length === 0) return
    setSaving(true)
    setMessage('')

    // Online classes with no explicit location auto-fill the instructor's
    // default meeting link (PHASE4_SPEC §5). In-person classes left blank get
    // the classroom-request loop at 14 days out.
    let location = defaultLocation.trim() || null
    if (!location && deliveryMode === 'online') {
      location = instructor.default_meeting_link ?? null
    }

    const newClass = {
      school_nickname: school.nickname, // legacy copy; to be dropped later
      school_id: school.id,
      counselor_id: counselorId || null,
      class_type: classType.trim(),
      instructor_id: instructor.id,
      instructor_name: instructor.name ?? instructor.email, // legacy copy
      instructor_email: instructor.email, // legacy copy
      price: Number(price),
      capacity: Number(capacity),
      start_date: startDate,
      default_location: location,
      synap_group: synapGroup.trim() || null,
      delivery_mode: deliveryMode,
      min_enrollment: Number(minEnrollment) || (deliveryMode === 'online' ? 3 : 8),
      enrollment_deadline: enrollmentDeadline || null,
      registration_close_date: registrationClose || null,
      slug: slugify(`${school.nickname}-${classType}-${termFor(startDate)}`),
    }

    let { data: created, error } = await supabase
      .from('classes')
      .insert([newClass])
      .select('id')
      .single()
    // Slug collision (same school/type/term): suffix until unique.
    for (let n = 2; error?.code === '23505' && n <= 5; n++) {
      ;({ data: created, error } = await supabase
        .from('classes')
        .insert([{ ...newClass, slug: `${newClass.slug}-${n}` }])
        .select('id')
        .single())
    }
    if (error || !created) {
      setMessage('Error creating class: ' + (error?.message ?? 'unknown'))
      setSaving(false)
      return
    }

    const { error: sessErr } = await supabase.from('sessions').insert(
      sorted.map((s) => ({
        class_id: created!.id,
        session_date: s.session_date,
        start_time: s.start_time || null,
        end_time: s.end_time || null,
        location: s.location.trim() || null,
      }))
    )
    if (sessErr) {
      // A class with zero sessions must not exist — roll the class back.
      await supabase.from('classes').delete().eq('id', created.id)
      setMessage('Error saving sessions (class not created): ' + sessErr.message)
      setSaving(false)
      return
    }

    // Reset for the next class.
    setStep(1)
    setSchoolId('')
    setCounselorId('')
    setClassType('')
    setInstructorId('')
    setPrice('')
    setCapacity('')
    setDeliveryMode('in_person')
    setMinEnrollment('8')
    setEnrollmentDeadline('')
    setRegistrationClose('')
    setSynapGroup('')
    setDefaultLocation('')
    setSessions([])
    setDraft({ session_date: '', start_time: '', end_time: '', location: '' })
    setMessage('Success — class created with ' + sorted.length + ' sessions.')
    setSaving(false)
    onCreated()
  }

  // -- render ----------------------------------------------------------------
  const steps = ['Details', 'Sessions', 'Review'] as const

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        {steps.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3
          const state = n === step ? 'current' : n < step ? 'done' : 'todo'
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <span className="text-gray-300">—</span>}
              <span
                className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                  state === 'current'
                    ? 'text-hgl-blue'
                    : state === 'done'
                      ? 'text-green-600'
                      : 'text-gray-400'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${
                    state === 'current'
                      ? 'bg-hgl-blue text-white'
                      : state === 'done'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {state === 'done' ? '✓' : n}
                </span>
                {label}
              </span>
            </div>
          )
        })}
      </div>

      {step === 1 && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">School</label>
            <select
              value={addingSchool ? '__new' : schoolId}
              onChange={(e) => {
                if (e.target.value === '__new') {
                  setAddingSchool(true)
                } else {
                  setAddingSchool(false)
                  setSchoolId(e.target.value)
                  setCounselorId('')
                  setAddingContact(false)
                }
              }}
              className={selectCls}
            >
              <option value="">Pick a school…</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nickname}
                </option>
              ))}
              <option value="__new">➕ Add a new school…</option>
            </select>
            {addingSchool && (
              <div className="grid grid-cols-2 gap-2 mt-2 items-end">
                <input
                  type="text"
                  placeholder="Nickname (e.g. Nido)"
                  value={newSchool.nickname}
                  onChange={(e) => setNewSchool({ ...newSchool, nickname: e.target.value })}
                  className="border border-gray-300 rounded-md p-2"
                />
                <input
                  type="text"
                  placeholder="Full name (optional)"
                  value={newSchool.name}
                  onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })}
                  className="border border-gray-300 rounded-md p-2"
                />
                <select
                  value={newSchool.timezone}
                  onChange={(e) => setNewSchool({ ...newSchool, timezone: e.target.value })}
                  className="border border-gray-300 rounded-md p-2 bg-white"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={saveNewSchool}
                  className="bg-hgl-slate text-white rounded-md p-2 font-semibold hover:opacity-90"
                >
                  Save school
                </button>
              </div>
            )}
            {school && (
              <p className="text-xs text-gray-500 mt-1">
                Timezone: <span className="font-semibold">{school.timezone}</span> (from the
                school record — class times are school-local)
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Class type</label>
            <input
              type="text"
              value={classType}
              onChange={(e) => setClassType(e.target.value)}
              list="wizard-class-types"
              placeholder="e.g. SAT Prep"
              className={inputCls}
            />
            <datalist id="wizard-class-types">
              {['SAT Prep', 'ACT Prep'].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <p className="text-xs text-gray-500 mt-1">Pick a suggestion or type anything.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Instructor</label>
            <select
              value={addingInstructor ? '__new' : instructorId}
              onChange={(e) => {
                if (e.target.value === '__new') setAddingInstructor(true)
                else {
                  setAddingInstructor(false)
                  setInstructorId(e.target.value)
                }
              }}
              className={selectCls}
            >
              <option value="">Pick an instructor…</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name ? `${i.name} (${i.email})` : i.email}
                </option>
              ))}
              <option value="__new">➕ Add a new instructor…</option>
            </select>
            {addingInstructor && (
              <div className="grid grid-cols-2 gap-2 mt-2 items-end">
                <input
                  type="text"
                  placeholder="Name"
                  value={newInstructor.name}
                  onChange={(e) => setNewInstructor({ ...newInstructor, name: e.target.value })}
                  className="border border-gray-300 rounded-md p-2"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={newInstructor.email}
                  onChange={(e) => setNewInstructor({ ...newInstructor, email: e.target.value })}
                  className="border border-gray-300 rounded-md p-2"
                />
                <input
                  type="url"
                  placeholder="Default meeting link (optional)"
                  value={newInstructor.default_meeting_link}
                  onChange={(e) =>
                    setNewInstructor({ ...newInstructor, default_meeting_link: e.target.value })
                  }
                  className="border border-gray-300 rounded-md p-2"
                />
                <button
                  type="button"
                  onClick={saveNewInstructor}
                  className="bg-hgl-slate text-white rounded-md p-2 font-semibold hover:opacity-90"
                >
                  Save instructor
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              School contact <span className="text-gray-400">(optional)</span>
            </label>
            <select
              value={addingContact ? '__new' : counselorId}
              onChange={(e) => {
                if (e.target.value === '__new') setAddingContact(true)
                else {
                  setAddingContact(false)
                  setCounselorId(e.target.value)
                }
              }}
              disabled={!schoolId}
              className={selectCls + ' disabled:bg-gray-50 disabled:text-gray-400'}
            >
              <option value="">All school contacts (default)</option>
              {schoolContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name} ({c.email})
                </option>
              ))}
              <option value="__new">➕ Add a new contact…</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Class-specific emails (room requests, final-days push, cancellation note) go to
              this contact; blank sends them to every contact at the school.
            </p>
            {addingContact && (
              <div className="grid grid-cols-2 gap-2 mt-2 items-end">
                <input
                  type="text"
                  placeholder="First name"
                  value={newContact.first_name}
                  onChange={(e) => setNewContact({ ...newContact, first_name: e.target.value })}
                  className="border border-gray-300 rounded-md p-2"
                />
                <input
                  type="text"
                  placeholder="Last name"
                  value={newContact.last_name}
                  onChange={(e) => setNewContact({ ...newContact, last_name: e.target.value })}
                  className="border border-gray-300 rounded-md p-2"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={newContact.email}
                  onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  className="border border-gray-300 rounded-md p-2"
                />
                <button
                  type="button"
                  onClick={saveNewContact}
                  className="bg-hgl-slate text-white rounded-md p-2 font-semibold hover:opacity-90"
                >
                  Save contact
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Price (USD)</label>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="750" className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Student capacity</label>
            <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="20" className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Delivery mode</label>
            <select
              value={deliveryMode}
              onChange={(e) => {
                const mode = e.target.value as 'in_person' | 'online'
                setDeliveryMode(mode)
                setMinEnrollment(mode === 'online' ? '3' : '8')
              }}
              className={selectCls}
            >
              <option value="in_person">In person</option>
              <option value="online">Online</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Minimum enrollment</label>
            <input type="number" value={minEnrollment} onChange={(e) => setMinEnrollment(e.target.value)} className={inputCls} />
            <p className="text-xs text-gray-500 mt-1">Default 8 in person / 3 online — editable.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Enrollment deadline</label>
            <input type="date" value={enrollmentDeadline} onChange={(e) => setEnrollmentDeadline(e.target.value)} className={inputCls} />
            <p className="text-xs text-gray-500 mt-1">Optional — min-enrollment check runs here (else 7 days before start).</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Registration closes</label>
            <input type="date" value={registrationClose} onChange={(e) => setRegistrationClose(e.target.value)} className={inputCls} />
            <p className="text-xs text-gray-500 mt-1">Blank = first session. Set later to allow mid-class joins.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default location</label>
            <input
              type="text"
              value={defaultLocation}
              onChange={(e) => setDefaultLocation(e.target.value)}
              placeholder={deliveryMode === 'online' ? "Blank = instructor's default meeting link" : 'Blank = counselor gets asked 14 days out'}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Synap group</label>
            <input type="url" value={synapGroup} onChange={(e) => setSynapGroup(e.target.value)} placeholder="https://…" className={inputCls} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          {sorted.length === 0 ? (
            <p className="text-sm text-gray-500 italic mb-3">
              No sessions yet — a class needs at least one session before it can be created.
            </p>
          ) : (
            <ul className="space-y-2 mb-4">
              {sorted.map((s, i) => (
                <li
                  key={`${s.session_date}-${i}`}
                  className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2"
                >
                  <span>
                    <strong>{formatDateAdmin(s.session_date)}</strong>
                    {s.start_time && ` · ${s.start_time}`}
                    {s.end_time && ` – ${s.end_time}`}
                    {s.location && ` · ${s.location}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSession(sessions.indexOf(s))}
                    className="text-red-600 text-xs hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border border-gray-200 rounded-md p-4 grid grid-cols-4 gap-3 items-end text-sm">
            <div>
              <label className="block text-xs text-gray-600">Date</label>
              <input
                type="date"
                value={draft.session_date}
                onChange={(e) => setDraft({ ...draft, session_date: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded p-1.5"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">Start (24h)</label>
              <div className="mt-1">
                <TimeSelect value={draft.start_time} onChange={(v) => setDraft({ ...draft, start_time: v })} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600">End (24h)</label>
              <div className="mt-1">
                <TimeSelect value={draft.end_time} onChange={(v) => setDraft({ ...draft, end_time: v })} />
              </div>
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-gray-600">Location (blank = class default)</label>
              <input
                type="text"
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder={defaultLocation || ''}
                className="mt-1 w-full border border-gray-300 rounded p-1.5"
              />
            </div>
            <button
              type="button"
              onClick={addSession}
              disabled={!draft.session_date}
              className="bg-hgl-slate text-white py-1.5 px-3 rounded hover:opacity-90 disabled:opacity-50"
            >
              Add session
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            After each add, the form pre-fills from that session — same times and location, one
            week later — so weekly schedules are one click per session.
          </p>
        </div>
      )}

      {step === 3 && school && instructor && (
        <div className="grid grid-cols-2 gap-8">
          <div className="text-sm space-y-1.5">
            <h3 className="font-bold text-hgl-slate text-base mb-2">
              {school.nickname} — {classType}
            </h3>
            <p><span className="text-gray-500">Instructor:</span> {instructor.name ?? instructor.email} ({instructor.email})</p>
            <p>
              <span className="text-gray-500">School contact:</span>{' '}
              {counselorId
                ? (() => {
                    const c = schoolContacts.find((x) => x.id === counselorId)
                    return c ? `${c.first_name} ${c.last_name} (${c.email})` : '—'
                  })()
                : 'all school contacts'}
            </p>
            <p><span className="text-gray-500">Starts:</span> {startDate ? formatDateAdmin(startDate) : '—'}</p>
            <p><span className="text-gray-500">Price:</span> ${Number(price || 0).toLocaleString()} · <span className="text-gray-500">Capacity:</span> {capacity} · <span className="text-gray-500">Min:</span> {minEnrollment}</p>
            <p><span className="text-gray-500">Mode:</span> {deliveryMode === 'online' ? 'Online' : 'In person'}</p>
            <p><span className="text-gray-500">Timezone:</span> {school.timezone} (from the school record)</p>
            <p>
              <span className="text-gray-500">Location:</span>{' '}
              {defaultLocation.trim() ||
                (deliveryMode === 'online'
                  ? (instructor.default_meeting_link ?? 'instructor has no default link — set later')
                  : 'blank — counselor gets asked 14 days out')}
            </p>
            <p><span className="text-gray-500">Enrollment deadline:</span> {enrollmentDeadline ? formatDateAdmin(enrollmentDeadline) : 'default (7 days before start)'}</p>
            <p><span className="text-gray-500">Registration closes:</span> {registrationClose ? formatDateAdmin(registrationClose) : 'first session (default)'}</p>
            {synapGroup && <p><span className="text-gray-500">Synap group:</span> {synapGroup}</p>}
          </div>
          <div>
            <h4 className="font-semibold text-hgl-slate text-sm mb-2">
              Session calendar ({sorted.length} session{sorted.length === 1 ? '' : 's'})
            </h4>
            <SessionCalendar
              sessions={sorted.map((s) => ({
                session_date: s.session_date,
                start_time: s.start_time || null,
                end_time: s.end_time || null,
                location: s.location.trim() || null,
              }))}
              defaultLocation={defaultLocation.trim() || null}
              hour24
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-6">
        <button
          type="button"
          onClick={() => setStep((s) => (s === 1 ? s : ((s - 1) as 1 | 2)))}
          disabled={step === 1}
          className="text-sm text-gray-500 underline hover:text-hgl-slate disabled:opacity-0"
        >
          ← Back
        </button>
        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s + 1) as 2 | 3)}
            disabled={step === 1 ? !detailsComplete : sessions.length === 0}
            title={
              step === 1 && !detailsComplete
                ? 'School, class type, instructor, price, and capacity are required'
                : step === 2 && sessions.length === 0
                  ? 'Add at least one session'
                  : undefined
            }
            className="bg-hgl-blue text-white font-bold py-2.5 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || sessions.length === 0}
            className="bg-hgl-blue text-white font-bold py-2.5 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-60"
          >
            {saving ? 'Creating…' : `Create class (${sorted.length} session${sorted.length === 1 ? '' : 's'})`}
          </button>
        )}
      </div>

      {message && (
        <div
          className={`mt-4 p-3 rounded text-center font-semibold ${
            message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
