'use client'

import { useEffect, useState } from 'react'
import { classLocationSentence } from '../utils/comms-variables'
import { supabase } from '../utils/supabase'
import SessionCalendar from '../components/SessionCalendar'
import { formatDateAdmin, addDays, monthYear } from '../utils/dates'
import { DateHint, TimeSelect, TimezoneSelect } from './ui'
import type { Instructor } from './instructors-panel'

// Class creation wizard (admin UX addendum, school-first revision):
// school → details → sessions → review. Everything downstream hangs off the
// school (timezone, contacts, collateral branding), so it's chosen first —
// with the add-a-new-school branch right there. Cannot complete with zero
// sessions; the class's start_date derives from the earliest session.
// School / contact / instructor are strict selects with explicit "+ Add new"
// actions — no free text, no find-or-create-by-typo. Each new session form
// pre-fills from the previous session (same times and location, date advanced
// a week — the weekly-cadence default).

export type School = {
  id: string
  name: string
  nickname: string
  timezone: string
}

export type ContactAtSchool = {
  id: string // ACTIVE affiliation id (what classes.counselor_id stores — addendum §6)
  contact_id: string // the person
  school_id: string
  first_name: string
  last_name: string
  email: string
}

export type SessionDraft = {
  session_date: string
  start_time: string // '' or 'HH:MM'
  end_time: string
  location: string
}

/**
 * Phase 5 "Copy a previous class": snapshot of a source class fed into the
 * wizard as initial state (remount with a fresh `key` per source). Sessions
 * arrive with times + locations copied and DATES BLANK — times repeat across
 * terms; dates never do. Never carries slug, enrollment_deadline, school
 * contact, or any enrollment/email/Stripe state.
 */
export type WizardPrefill = {
  schoolId: string
  classType: string
  deliveryMode: 'in_person' | 'online'
  price: string
  capacity: string
  minEnrollment: string
  instructorId: string
  synapGroup: string
  defaultLocation: string
  sessions: SessionDraft[]
  /** "Duplicate class": collateral fields carried onto the new class row
   *  verbatim — including the promo trio (repeat cohorts usually rerun the
   *  same offer; the admin edits the deadline on the Collateral card).
   *  Absent for Phase 5 copy. */
  collateral?: {
    short_link: string | null
    collateral_language: string | null
    flyer_blurb: string | null
    letter_blurb: string | null
    letter_blurb_es: string | null
    practice_test_count: number | null
    promo_code: string | null
    promo_amount: number | null
    promo_deadline: string | null
  }
}

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
  initial,
  onSchoolsChange,
  onContactsChange,
  onInstructorsChange,
  onCreated,
}: {
  schools: School[]
  contacts: ContactAtSchool[]
  instructors: Instructor[]
  /** Copy-a-previous-class prefill — pass a fresh `key` with it to remount. */
  initial?: WizardPrefill
  onSchoolsChange: () => void
  onContactsChange: () => void
  onInstructorsChange: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // -- step 1: details ------------------------------------------------------
  const [schoolId, setSchoolId] = useState(initial?.schoolId ?? '')
  const [counselorId, setCounselorId] = useState('') // '' = all school contacts; never copied
  const [classType, setClassType] = useState(initial?.classType ?? '')
  const [instructorId, setInstructorId] = useState(initial?.instructorId ?? '')
  const [price, setPrice] = useState(initial?.price ?? '')
  const [capacity, setCapacity] = useState(initial?.capacity ?? '')
  const [deliveryMode, setDeliveryMode] = useState<'in_person' | 'online'>(
    initial?.deliveryMode ?? 'in_person'
  )
  const [minEnrollment, setMinEnrollment] = useState(initial?.minEnrollment ?? '8')
  const [enrollmentDeadline, setEnrollmentDeadline] = useState('') // cohort-specific; never copied
  const [deadlineEdited, setDeadlineEdited] = useState(false)
  const [registrationClose, setRegistrationClose] = useState('') // cohort-specific; never copied
  const [synapGroup, setSynapGroup] = useState(initial?.synapGroup ?? '')
  const [defaultLocation, setDefaultLocation] = useState(initial?.defaultLocation ?? '')

  // -- step 2: sessions ------------------------------------------------------
  const [sessions, setSessions] = useState<SessionDraft[]>(initial?.sessions ?? [])
  const [draft, setDraft] = useState<SessionDraft>({
    session_date: '',
    start_time: '',
    end_time: '',
    location: '',
  })
  const [sessionError, setSessionError] = useState('')

  const school = schools.find((s) => s.id === schoolId) ?? null
  const instructor = instructors.find((i) => i.id === instructorId) ?? null
  const schoolContacts = contacts.filter((c) => c.school_id === schoolId)
  const sorted = [...sessions].sort(
    (a, b) =>
      a.session_date.localeCompare(b.session_date) ||
      (a.start_time ?? '').localeCompare(b.start_time ?? '')
  )
  const startDate = sorted[0]?.session_date ?? ''

  // PL-15: in-person classes are often taught on-site far away, so HGL needs
  // an early "commit by" date (~5–6 weeks before start) to arrange instructor
  // travel. Default it once sessions give us a start date; online classes can
  // close near the start, so no default. Editable either way — a manual edit
  // stops the auto-fill.
  useEffect(() => {
    if (deadlineEdited) return
    if (deliveryMode === 'in_person' && startDate) {
      setEnrollmentDeadline(addDays(startDate, -38))
    } else if (deliveryMode === 'online') {
      setEnrollmentDeadline('')
    }
  }, [deliveryMode, startDate, deadlineEdited])

  // -- "+ Add new" inline creators ------------------------------------------
  const [addingSchool, setAddingSchool] = useState(false)
  // A school without a contact is useless downstream (room requests, digests,
  // final-days push all need someone) — so creating a school REQUIRES its
  // first contact (addendum §7.1), and the full name is REQUIRED too
  // (nickname alone is ambiguous internally — ASM = Milan or Madrid).
  // Branding fields (logo / accent / language) are part of school SETUP —
  // captured once here, then class creation never touches branding again
  // (out-of-flow edits live in the School branding panel).
  const [newSchool, setNewSchool] = useState({
    nickname: '',
    name: '',
    timezone: '',
    contactFirst: '',
    contactLast: '',
    contactEmail: '',
    accentColor: '',
    collateralLanguage: 'en',
  })
  const [newSchoolLogo, setNewSchoolLogo] = useState<File | null>(null)
  const [addingContact, setAddingContact] = useState(false)
  const [newContact, setNewContact] = useState({ first_name: '', last_name: '', email: '' })
  const [addingInstructor, setAddingInstructor] = useState(false)
  const [newInstructor, setNewInstructor] = useState({ name: '', email: '', default_meeting_link: '' })

  /** Find-or-create the person by email, then reuse or open an ACTIVE
   * affiliation at the school. Returns the affiliation id (what
   * classes.counselor_id stores), or null after setting an error message. */
  async function ensureContactAffiliation(
    targetSchoolId: string,
    info: { first: string; last: string; email: string }
  ): Promise<string | null> {
    const email = info.email.trim().toLowerCase()
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .ilike('email', email)
      .maybeSingle()
    let contactId = existing?.id as string | undefined
    if (!contactId) {
      const { data: created, error } = await supabase
        .from('contacts')
        .insert([{ first_name: info.first.trim(), last_name: info.last.trim(), email }])
        .select('id')
        .single()
      if (error || !created) {
        setMessage('Error adding contact: ' + (error?.message ?? 'unknown'))
        return null
      }
      contactId = created.id
    }
    const reuse = contacts.find(
      (c) => c.contact_id === contactId && c.school_id === targetSchoolId
    )?.id
    if (reuse) return reuse
    const { data: aff, error: affErr } = await supabase
      .from('school_affiliations')
      .insert([{ contact_id: contactId, school_id: targetSchoolId, role: 'counselor' }])
      .select('id')
      .single()
    if (affErr || !aff) {
      setMessage('Error adding affiliation: ' + (affErr?.message ?? 'unknown'))
      return null
    }
    return aff.id
  }

  const newSchoolComplete = Boolean(
    newSchool.nickname.trim() &&
      newSchool.name.trim() &&
      newSchool.timezone &&
      newSchool.contactFirst.trim() &&
      newSchool.contactLast.trim() &&
      newSchool.contactEmail.trim()
  )

  async function saveNewSchool() {
    if (!newSchoolComplete) {
      setMessage('Error: a new school needs nickname, full name, timezone, and a contact.')
      return
    }
    if (newSchool.accentColor && !/^#[0-9a-fA-F]{6}$/.test(newSchool.accentColor)) {
      setMessage('Error: accent must be a hex color like #7a1f3d (or blank for HGL blue).')
      return
    }
    const { data, error } = await supabase
      .from('schools')
      .insert([
        {
          nickname: newSchool.nickname.trim(),
          name: newSchool.name.trim(),
          timezone: newSchool.timezone,
          accent_color: newSchool.accentColor || null,
          collateral_language: newSchool.collateralLanguage,
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
    // Logo goes through the processing route (white background removed,
    // borders trimmed) — a failure leaves the school usable, the flyer just
    // omits the crest until a retry from the School branding panel.
    if (newSchoolLogo) {
      const body = new FormData()
      body.set('schoolId', data.id)
      body.set('file', newSchoolLogo)
      const res = await fetch('/api/admin/school-logo', { method: 'POST', body })
      if (!res.ok) {
        setMessage(
          `School saved, but the logo upload failed (${await res.text()}) — retry from the School branding panel.`
        )
      }
    }
    const affiliationId = await ensureContactAffiliation(data.id, {
      first: newSchool.contactFirst,
      last: newSchool.contactLast,
      email: newSchool.contactEmail,
    })
    if (!affiliationId) return // school saved; contact error message already set
    if (!newSchoolLogo) setMessage('')
    onSchoolsChange()
    onContactsChange()
    setSchoolId(data.id)
    setCounselorId(affiliationId)
    setAddingSchool(false)
    setNewSchool({
      nickname: '', name: '', timezone: '', contactFirst: '', contactLast: '',
      contactEmail: '', accentColor: '', collateralLanguage: 'en',
    })
    setNewSchoolLogo(null)
  }

  async function saveNewContact() {
    if (!schoolId || !newContact.email.trim()) return
    const affiliationId = await ensureContactAffiliation(schoolId, {
      first: newContact.first_name,
      last: newContact.last_name,
      email: newContact.email,
    })
    if (!affiliationId) return
    setMessage('')
    onContactsChange()
    setCounselorId(affiliationId)
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
    // End must be after start on the same date (addendum §7.1) — without this,
    // 12:00–10:00 saved silently.
    if (draft.start_time && draft.end_time && draft.end_time <= draft.start_time) {
      setSessionError('End time must be after the start time.')
      return
    }
    setSessionError('')
    setSessions((prev) => [...prev, draft])
    // Pre-fill the next form from this session: same times and location,
    // date advanced a week (weekly cadence is the norm; still editable).
    setDraft({ ...draft, session_date: addDays(draft.session_date, 7) })
  }

  function removeSession(idx: number) {
    setSessions((prev) => prev.filter((_, i) => i !== idx))
  }

  // Copied session rows arrive with blank dates (times repeat across terms;
  // dates never do) — each gets an inline date input until it's set.
  function setSessionDate(idx: number, date: string) {
    setSessions((prev) => prev.map((s, i) => (i === idx ? { ...s, session_date: date } : s)))
  }

  const allDated = sessions.every((s) => s.session_date !== '')

  // -- create ----------------------------------------------------------------
  // Instructor is OPTIONAL (addendum §7.3) — classes are frequently created
  // before an instructor is confirmed. The scheduling nudge + #4's
  // hold-and-alert are the safety nets.
  const detailsComplete = Boolean(classType.trim() && price && capacity)

  async function handleCreate() {
    if (!school || sessions.length === 0 || !allDated) return
    setSaving(true)
    setMessage('')

    // Online classes with no explicit location auto-fill the instructor's
    // default meeting link (PHASE4_SPEC §5). In-person classes left blank get
    // PL-61: minimums are positive integers, full stop — "-1 min / 10 cap ·
    // runs (min -1 met)" must never happen again. Blank falls back to the
    // mode default; anything below 1 blocks the save.
    const minRaw = minEnrollment.trim()
    const minSanitized = minRaw === '' ? (deliveryMode === 'online' ? 3 : 8) : Math.trunc(Number(minRaw))
    if (!Number.isFinite(minSanitized) || minSanitized < 1) {
      setMessage('Error: minimum enrollment must be a whole number of at least 1.')
      setSaving(false)
      return
    }

    // the classroom-request loop at 14 days out.
    let location = defaultLocation.trim() || null
    if (!location && deliveryMode === 'online' && instructor) {
      location = instructor.default_meeting_link ?? null
    }

    const newClass = {
      school_id: school.id,
      counselor_id: counselorId || null,
      class_type: classType.trim(),
      instructor_id: instructor?.id ?? null,
      price: Number(price),
      capacity: Number(capacity),
      start_date: startDate,
      default_location: location,
      synap_group: synapGroup.trim() || null,
      delivery_mode: deliveryMode,
      min_enrollment: minSanitized,
      enrollment_deadline: enrollmentDeadline || null,
      registration_close_date: registrationClose || null,
      slug: slugify(`${school.nickname}-${classType}-${termFor(startDate)}`),
      // Duplicate-class prefill carries the collateral fields onto the new row.
      ...(initial?.collateral ?? {}),
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
  // PL-61: sanity warning for unusually low minimums — non-blocking ("sure?"),
  // but a minimum below 1 blocks the save outright (Cape Town shipped as -1).
  const minParsed = Math.trunc(Number(minEnrollment))
  const usualMin = deliveryMode === 'online' ? 3 : 8
  const minWarning =
    Number.isFinite(minParsed) && minParsed >= 1 && minParsed < usualMin
      ? `Below the usual minimum for ${deliveryMode === 'online' ? 'online' : 'in-person'} classes (${usualMin}) — you can save, but double-check it's intentional.`
      : null

  const steps = ['School', 'Details', 'Sessions', 'Review'] as const

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        {steps.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4
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
                  {s.nickname} — {s.name}
                </option>
              ))}
              <option value="__new">➕ Add a new school…</option>
            </select>
            {addingSchool && (
              <div className="mt-2 space-y-2 border border-gray-200 rounded-md p-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Nickname (e.g. Nido)"
                    value={newSchool.nickname}
                    onChange={(e) => setNewSchool({ ...newSchool, nickname: e.target.value })}
                    className="border border-gray-300 rounded-md p-2"
                  />
                  <input
                    type="text"
                    placeholder="Full name (required — ASM alone is ambiguous)"
                    value={newSchool.name}
                    onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })}
                    className="border border-gray-300 rounded-md p-2"
                  />
                </div>
                <TimezoneSelect
                  value={newSchool.timezone}
                  onChange={(tz) => setNewSchool({ ...newSchool, timezone: tz })}
                />
                <p className="text-xs text-gray-500">
                  First contact at the school (required — room requests, digests, and the
                  final-days push all need someone to email):
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Contact first name"
                    value={newSchool.contactFirst}
                    onChange={(e) => setNewSchool({ ...newSchool, contactFirst: e.target.value })}
                    className="border border-gray-300 rounded-md p-2"
                  />
                  <input
                    type="text"
                    placeholder="Contact last name"
                    value={newSchool.contactLast}
                    onChange={(e) => setNewSchool({ ...newSchool, contactLast: e.target.value })}
                    className="border border-gray-300 rounded-md p-2"
                  />
                  <input
                    type="email"
                    placeholder="Contact email"
                    value={newSchool.contactEmail}
                    onChange={(e) => setNewSchool({ ...newSchool, contactEmail: e.target.value })}
                    className="border border-gray-300 rounded-md p-2"
                  />
                </div>
                <p className="text-xs text-gray-500 pt-1">
                  Collateral branding (used on the generated flyer &amp; parent letter — set once
                  here, edit later in the School branding panel):
                </p>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <label className="text-xs text-gray-600 col-span-3 -mb-1">School logo (flyer top-right; optional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setNewSchoolLogo(e.target.files?.[0] ?? null)}
                    className="col-span-3 text-xs"
                  />
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-gray-600">Accent</label>
                    <input
                      type="color"
                      value={newSchool.accentColor || '#00AEEE'}
                      onChange={(e) => setNewSchool({ ...newSchool, accentColor: e.target.value })}
                      className="h-7 w-9 border border-gray-300 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={newSchool.accentColor}
                      onChange={(e) => setNewSchool({ ...newSchool, accentColor: e.target.value })}
                      placeholder="HGL blue"
                      className="w-20 border border-gray-300 rounded p-1 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 col-span-2">
                    <label className="text-xs text-gray-600">Collateral language</label>
                    <select
                      value={newSchool.collateralLanguage}
                      onChange={(e) =>
                        setNewSchool({ ...newSchool, collateralLanguage: e.target.value })
                      }
                      className="border border-gray-300 rounded p-1 text-xs bg-white"
                    >
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={saveNewSchool}
                  disabled={!newSchoolComplete}
                  className="bg-hgl-slate text-white rounded-md py-2 px-4 font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  Save school + contact
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
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-2 gap-4">
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
            <label className="block text-sm font-medium text-gray-700">
              Instructor <span className="text-gray-400">(optional — often confirmed later)</span>
            </label>
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
              <option value="">Not yet assigned</option>
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
            <input type="number" min={1} step={1} value={minEnrollment} onChange={(e) => setMinEnrollment(e.target.value)} className={inputCls} />
            <p className="text-xs text-gray-500 mt-1">Default 8 in person / 3 online — editable.</p>
            {/* PL-61: warn (never block) below the usual minimum for the mode */}
            {minWarning && <p className="text-xs text-amber-700 mt-1">{minWarning}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Enrollment deadline</label>
            <input
              type="date"
              value={enrollmentDeadline}
              onChange={(e) => {
                setDeadlineEdited(true)
                setEnrollmentDeadline(e.target.value)
              }}
              className={inputCls}
            />
            <DateHint value={enrollmentDeadline} />
            <p className="text-xs text-gray-500 mt-1">
              Your commit-by date — the flyer and letter print THIS as the urgency date, and the
              min-enrollment check runs here (else 7 days before start). In-person classes default
              to ~5–6 weeks before start so there&apos;s time to arrange instructor travel.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Registration closes</label>
            <input type="date" value={registrationClose} onChange={(e) => setRegistrationClose(e.target.value)} className={inputCls} />
            <DateHint value={registrationClose} />
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
            {/* PL-68: live preview of the exact email sentence — a hint, never
                blocking; whoever types the value words it to fit. */}
            {defaultLocation.trim() && (
              <p className="text-xs text-gray-500 mt-1">
                Families will see: &ldquo;{classLocationSentence(defaultLocation)}&rdquo;
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Synap group</label>
            <input type="url" value={synapGroup} onChange={(e) => setSynapGroup(e.target.value)} placeholder="https://…" className={inputCls} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          {school && (
            <p className="text-xs text-gray-500 mb-3">
              All times in <span className="font-semibold">{school.timezone}</span> (from the
              school record, read-only)
            </p>
          )}
          {sorted.length > 0 && !allDated && (
            <p className="text-sm text-amber-700 font-semibold mb-3">
              Copied sessions need dates — times and locations carried over; enter each new
              date below.
            </p>
          )}
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
                  <span className="flex items-center gap-2">
                    {s.session_date ? (
                      <strong>{formatDateAdmin(s.session_date)}</strong>
                    ) : (
                      <input
                        type="date"
                        value=""
                        onChange={(e) => setSessionDate(sessions.indexOf(s), e.target.value)}
                        className="border border-amber-400 rounded p-1"
                        title="Copied session — enter the new date"
                      />
                    )}
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

          {sessionError && (
            <p className="text-sm text-red-600 font-semibold mb-2">{sessionError}</p>
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
              <DateHint value={draft.session_date} />
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

      {step === 4 && school && (
        <div className="grid grid-cols-2 gap-8">
          <div className="text-sm space-y-1.5">
            <h3 className="font-bold text-hgl-slate text-base mb-2">
              {school.nickname} — {classType}
            </h3>
            <p>
              <span className="text-gray-500">Instructor:</span>{' '}
              {instructor
                ? `${instructor.name ?? instructor.email} (${instructor.email})`
                : 'Not yet assigned — the scheduling nudge fires once enrollment reaches minimum'}
            </p>
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
                  ? (instructor?.default_meeting_link ??
                    (instructor
                      ? 'instructor has no default link — set later'
                      : 'set when the instructor is assigned'))
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
          onClick={() => setStep((s) => (s === 1 ? s : ((s - 1) as 1 | 2 | 3)))}
          disabled={step === 1}
          className="text-sm text-gray-500 underline hover:text-hgl-slate disabled:opacity-0"
        >
          ← Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s + 1) as 2 | 3 | 4)}
            disabled={
              step === 1
                ? !schoolId
                : step === 2
                  ? !detailsComplete
                  : sessions.length === 0 || !allDated
            }
            title={
              step === 1 && !schoolId
                ? 'Pick (or add) the school first — everything else hangs off it'
                : step === 2 && !detailsComplete
                  ? 'Class type, price, and capacity are required'
                  : step === 3 && sessions.length === 0
                    ? 'Add at least one session'
                    : step === 3 && !allDated
                      ? 'Every copied session needs a date first'
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
            disabled={saving || sessions.length === 0 || !allDated}
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
