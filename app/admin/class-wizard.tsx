'use client'

import { useEffect, useState } from 'react'
import { classLocationSentence } from '../utils/comms-variables'
import { supabase } from '../utils/supabase'
import SessionCalendar from '../components/SessionCalendar'
import { formatDateAdmin, addDays, monthYear } from '../utils/dates'
import { DateHint, TimeSelect, TimezoneSelect } from './ui'
import type { Instructor } from './instructors-panel'
import { escapeLike } from '../utils/like-escape'

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
  /** PL-237: branding lives on the school record; the wizard's Branding &
   *  Collateral step edits it in place (same rows as Classes → Schools). */
  logo_url?: string | null
  accent_color?: string | null
  collateral_language?: string | null
  /** PL-353: the city families associate with the school — public time labels. */
  city?: string | null
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
    /** PL-348: hero bullets on the public /c/{slug} page, one per line. */
    selling_bullets?: string | null
    /** PL-355: prerequisite line near the bullets ("For students who…"). */
    prerequisite_note?: string | null
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
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  // PL-288: the post-create closure screen (Add another / Back to classes /
  // Back to dashboard) — replaces the old banner-over-a-reset-wizard state.
  const [createdSummary, setCreatedSummary] = useState<{
    classId: string
    label: string
    sessionCount: number
  } | null>(null)
  // PL-239: when an error names a fixable field, the message carries the
  // step to jump to — one click lands on the field, no decoding required.
  const [messageStep, setMessageStep] = useState<1 | 2 | 3 | 4 | null>(null)

  // -- step 1: details ------------------------------------------------------
  const [schoolId, setSchoolId] = useState(initial?.schoolId ?? '')
  // PL-274: open-enrollment classes have NO school. Two flavors: online
  // (asks its timezone explicitly) and in-person at Higher Ground (Denver).
  const [openKind, setOpenKind] = useState<'' | 'online' | 'hgl'>('')
  const [openTimezone, setOpenTimezone] = useState('America/Denver')
  // PL-353: the city list an ONLINE class labels its times with ("Milan,
  // Munich") — public pages never show a bare IANA zone city.
  const [displayCities, setDisplayCities] = useState('')
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
  // PL-274 amendment B: two independent per-class switches — emails and nags
  // condition on them (diagnostics-off drops diagnostic promises/reminders;
  // Synap-off drops Synap links; both off skips #2 entirely).
  const [hasDiagnostics, setHasDiagnostics] = useState(true)
  // PL-311: explicit follow-up flag (open-enrollment classes only) — gates
  // the roster's FO marketing controls.
  const [isFollowOn, setIsFollowOn] = useState(false)
  // PL-316: per-row session editing (same pickers as the add form).
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<SessionDraft | null>(null)
  // PL-329: multi-select + bulk apply (Scarlett's case: cloned a weekly
  // schedule, then realized the TIME was wrong on every row). Pre-save UI
  // state only — no email implications in the wizard.
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set())
  const [bulkStart, setBulkStart] = useState('')
  const [bulkEnd, setBulkEnd] = useState('')
  const [bulkLocation, setBulkLocation] = useState('')
  const [bulkShiftDays, setBulkShiftDays] = useState('')
  // PL-106: collateral basics are part of creating the class, not an
  // afterthought on the card — the card keeps full editing + regeneration.
  const [shortLink, setShortLink] = useState(initial?.collateral?.short_link ?? '')
  const [collateralLang, setCollateralLang] = useState(initial?.collateral?.collateral_language ?? '')
  // PL-239 (Scarlett, Jul 30): practice tests DEFAULT to 2, editable — the
  // create can never hit the DB's not-null constraint from an untouched field.
  const [practiceTestCount, setPracticeTestCount] = useState(
    initial?.collateral?.practice_test_count != null ? String(initial.collateral.practice_test_count) : '2'
  )
  const [flyerBlurb, setFlyerBlurb] = useState(initial?.collateral?.flyer_blurb ?? '')
  // PL-237: the rest of the collateral card's fields live on the wizard's
  // Branding & Collateral step now (letter paragraphs + the promo trio).
  const [letterBlurb, setLetterBlurb] = useState(initial?.collateral?.letter_blurb ?? '')
  const [letterBlurbEs, setLetterBlurbEs] = useState(initial?.collateral?.letter_blurb_es ?? '')
  const [promoCode, setPromoCode] = useState(initial?.collateral?.promo_code ?? '')
  const [promoAmount, setPromoAmount] = useState(
    initial?.collateral?.promo_amount != null ? String(initial.collateral.promo_amount) : ''
  )
  const [promoDeadline, setPromoDeadline] = useState(initial?.collateral?.promo_deadline ?? '')
  // PL-348: the public class page's hero bullets (one per line).
  const [sellingBullets, setSellingBullets] = useState(initial?.collateral?.selling_bullets ?? '')
  // PL-355 D: the public page's prerequisite line (follow-up classes mainly).
  const [prerequisiteNote, setPrerequisiteNote] = useState(initial?.collateral?.prerequisite_note ?? '')
  // 'Skip for now (remind me later)' stamps collateral_reminder_at on the
  // class -> the state-driven Needs Attention row.
  const [skipForNow, setSkipForNow] = useState(false)
  // School branding edits at the B&C step write the schools row directly.
  const [schoolAccent, setSchoolAccent] = useState('')
  const [schoolLanguage, setSchoolLanguage] = useState('en')
  const [brandingMsg, setBrandingMsg] = useState('')
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
  // PL-274: open-enrollment — no school; the class carries its own timezone.
  const isOpen = openKind !== ''
  const classTimezone = isOpen ? (openKind === 'hgl' ? 'America/Denver' : openTimezone) : (school?.timezone ?? '')
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
  // PL-237: seed the school-branding editors from the picked school.
  useEffect(() => {
    setSchoolAccent(school?.accent_color ?? '')
    setSchoolLanguage(school?.collateral_language ?? 'en')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId])

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
      .ilike('email', escapeLike(email))
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
  // PL-239: a disabled Next must SAY why — one needs-list drives the button
  // state, the live list under it, and the field markers.
  const practiceTestsValid =
    practiceTestCount.trim() !== '' &&
    Number.isFinite(Number(practiceTestCount)) &&
    Math.trunc(Number(practiceTestCount)) >= 0
  const detailsNeeds = [
    !classType.trim() && 'class type',
    !price && 'price',
    !capacity && 'capacity',
  ].filter(Boolean) as string[]
  // PL-237/239: the collateral step validates its own fields.
  const promoPartial =
    [promoCode.trim(), promoAmount.trim(), promoDeadline].filter(Boolean).length % 3 !== 0
  const collateralNeeds = [
    !practiceTestsValid && 'the number of practice tests (0 or more — it defaults to 2)',
    promoPartial && 'the promo needs its code, amount, and deadline together (or clear all three)',
  ].filter(Boolean) as string[]
  const detailsComplete = detailsNeeds.length === 0
  const stepNeeds: string[] =
    step === 1
      ? schoolId || openKind
        ? []
        : ['a school — pick one, add one, or choose open enrollment']
      : step === 2
        ? detailsNeeds
        : step === 3
          ? ([
              sessions.length === 0 && 'at least one session',
              sessions.length > 0 && !allDated && 'a date on every copied session',
            ].filter(Boolean) as string[])
          : step === 4
            ? collateralNeeds
            : []

  // PL-239: no raw DB/constraint text reaches the admin — known failures get
  // plain English plus the step to fix them on; unknown ones lead with a
  // plain summary and tuck the technical detail at the end.
  function explainCreateError(error: { code?: string; message?: string } | null): {
    text: string
    step: 1 | 2 | 3 | 4 | null
  } {
    const msg = error?.message ?? 'unknown'
    const FIELDS: Record<string, { text: string; step: 1 | 2 | 3 | 4 }> = {
      practice_test_count: { text: 'The number of practice tests is missing', step: 4 },
      price: { text: 'The price is missing', step: 2 },
      capacity: { text: 'The student capacity is missing', step: 2 },
      class_type: { text: 'The class type is missing', step: 2 },
      school_id: { text: 'The school is missing', step: 1 },
      min_enrollment: { text: 'The minimum enrollment is missing', step: 2 },
      start_date: { text: 'The start date is missing — it comes from the first session', step: 3 },
    }
    const nullCol = msg.match(/null value in column "([^"]+)"/)?.[1]
    if (nullCol && FIELDS[nullCol]) {
      return { text: `Error: ${FIELDS[nullCol].text} — fill it in and create again.`, step: FIELDS[nullCol].step }
    }
    if (nullCol) {
      return {
        text: `Error: the "${nullCol.replace(/_/g, ' ')}" field is missing a value — fill it in and create again.`,
        step: null,
      }
    }
    if (error?.code === '23503') {
      return { text: 'Error: the class points at a school or instructor that no longer exists — re-pick them.', step: 1 }
    }
    return {
      text: `Error: the class couldn't be saved — nothing was created. (Technical detail: ${msg})`,
      step: null,
    }
  }

  async function handleCreate() {
    if ((!school && !isOpen) || sessions.length === 0 || !allDated) return
    setSaving(true)
    setMessage('')
    setMessageStep(null)

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
      // PL-274: open enrollment — no school, no counselor, the class carries
      // its own timezone, and the slug is minted from type + term alone.
      school_id: school?.id ?? null,
      counselor_id: isOpen ? null : counselorId || null,
      timezone: isOpen ? classTimezone : null,
      // PL-353: online classes may carry their own public city list.
      display_cities: isOpen && openKind === 'online' ? displayCities.trim() || null : null,
      has_diagnostics: hasDiagnostics,
      is_follow_on: isOpen ? isFollowOn : false,
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
      slug: isOpen
        ? slugify(`${classType}-${termFor(startDate)}`)
        : slugify(`${school!.nickname}-${classType}-${termFor(startDate)}`),
      // Duplicate-class prefill carries the collateral fields onto the new
      // row; the four visible wizard fields (PL-106) win over the prefill.
      ...(initial?.collateral ?? {}),
      short_link: shortLink.trim() || null,
      collateral_language: collateralLang || null,
      letter_blurb: letterBlurb.trim() || null,
      letter_blurb_es: letterBlurbEs.trim() || null,
      promo_code: promoCode.trim() || null,
      promo_amount: promoAmount.trim() === '' ? null : Number(promoAmount),
      promo_deadline: promoDeadline || null,
      // PL-237: skip-for-now stamps the reminder; the Needs Attention row is
      // state-driven (shows while stamped AND no short link) — no bookkeeping.
      // PL-274: open classes have no collateral at all — never stamp.
      collateral_reminder_at: !isOpen && skipForNow ? new Date().toISOString() : null,
      // PL-239: never null — the field defaults to 2 and validates at its
      // step, and this belt catches any path that skips both.
      practice_test_count: practiceTestCount.trim() === '' ? 2 : Math.trunc(Number(practiceTestCount)),
      flyer_blurb: flyerBlurb.trim() || null,
      // PL-348: the public page's hero bullets (one per line). Included only
      // when set — or when the duplicate prefill carried the key (so clearing
      // the textarea beats the spread above) — so class creation keeps
      // working before the migration lands.
      ...(sellingBullets.trim() || (initial?.collateral && 'selling_bullets' in initial.collateral)
        ? { selling_bullets: sellingBullets.trim() || null }
        : {}),
      // PL-355 A: course identity for open-enrollment classes — DERIVED from
      // the class type (duplicates copy the type, so re-runs share the key
      // with nothing extra to remember; renaming the type for a re-run
      // changes which course-type blocks it inherits — deliberate).
      course_key: isOpen ? slugify(classType.trim()) || null : null,
      // PL-355 D: the public page's prerequisite line.
      ...(prerequisiteNote.trim() || (initial?.collateral && 'prerequisite_note' in initial.collateral)
        ? { prerequisite_note: prerequisiteNote.trim() || null }
        : {}),
    }
    if (!Number.isFinite(newClass.practice_test_count) || newClass.practice_test_count < 0) {
      setMessage('Error: the number of practice tests must be a whole number (0 or more).')
      setMessageStep(2)
      setSaving(false)
      return
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
      const explained = explainCreateError(error)
      setMessage(explained.text)
      setMessageStep(explained.step)
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
      setMessage(
        `Error: the sessions couldn't be saved, so the class was NOT created — nothing half-made to clean up. Check each session's date and times, then create again. (Technical detail: ${sessErr.message})`
      )
      setMessageStep(3)
      setSaving(false)
      return
    }

    // PL-288: a dedicated closure screen replaces the old inline banner that
    // sat confusingly on top of an already-reset wizard.
    setCreatedSummary({ classId: created.id, label: classType.trim() || 'The class', sessionCount: sorted.length })
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
    setShortLink('')
    setCollateralLang('')
    setPracticeTestCount('2')
    setFlyerBlurb('')
    setLetterBlurb('')
    setLetterBlurbEs('')
    setPromoCode('')
    setPromoAmount('')
    setPromoDeadline('')
    setSellingBullets('')
    setPrerequisiteNote('')
    setDisplayCities('')
    setSkipForNow(false)
    setDefaultLocation('')
    setSessions([])
    setDraft({ session_date: '', start_time: '', end_time: '', location: '' })
    setMessage('')
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

  const steps = ['School', 'Details', 'Sessions', 'Branding & Collateral', 'Review'] as const

  // PL-288: clear closure after a create — the wizard is already reset
  // behind this screen, so "Add another class" just returns to it.
  if (createdSummary) {
    return (
      <div className="max-w-xl">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 space-y-4">
          <h3 className="text-xl font-bold text-green-800">
            {createdSummary.label} is created 🎉
          </h3>
          <p className="text-sm text-green-900">
            {createdSummary.sessionCount} session{createdSummary.sessionCount === 1 ? '' : 's'} scheduled.
            The class is live on its roster — registration link, deadlines, and follow-up settings
            all live there.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setCreatedSummary(null)}
              className="bg-hgl-slate text-white font-bold px-4 py-2 rounded hover:opacity-90"
            >
              Add another class
            </button>
            <a
              href={`/admin?class=${createdSummary.classId}`}
              className="bg-white border border-gray-300 text-gray-700 font-bold px-4 py-2 rounded hover:border-hgl-slate"
            >
              Back to classes
            </a>
            <a
              href="/admin"
              className="bg-white border border-gray-300 text-gray-700 font-bold px-4 py-2 rounded hover:border-hgl-slate"
            >
              Back to dashboard
            </a>
          </div>
        </div>
      </div>
    )
  }

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
              value={addingSchool ? '__new' : openKind ? `__open_${openKind}` : schoolId}
              onChange={(e) => {
                const v = e.target.value
                if (v === '__new') {
                  setAddingSchool(true)
                  setOpenKind('')
                } else if (v === '__open_online' || v === '__open_hgl') {
                  // PL-274: no school — clears every school-coupled choice.
                  setAddingSchool(false)
                  setOpenKind(v === '__open_online' ? 'online' : 'hgl')
                  setSchoolId('')
                  setCounselorId('')
                  setAddingContact(false)
                  setDeliveryMode(v === '__open_online' ? 'online' : 'in_person')
                  if (v === '__open_hgl') setDefaultLocation('380 W. Pierpont Ave, Salt Lake City, UT')
                } else {
                  setAddingSchool(false)
                  setOpenKind('')
                  setSchoolId(v)
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
              <option value="__open_online">🌐 No school — open enrollment, online</option>
              <option value="__open_hgl">🏔 No school — in person at Higher Ground</option>
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
                {/* PL-237: branding (logo / accent / language) moved to the
                    wizard's Branding & Collateral step — the school record
                    exists by then, so the logo upload works there too. */}
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
                Timezone: <span className="font-semibold">{school.timezone}</span>{' '}(from the
                school record — class times are school-local)
              </p>
            )}
          </div>

          {isOpen ? (
            <div className="text-sm text-gray-600 bg-blue-50/60 border border-blue-100 rounded-md p-3 self-start">
              <p className="font-semibold text-hgl-slate mb-1">Open enrollment — no school machinery</p>
              <p>
                No school contact, no classroom request, no counselor emails, and no flyer/letter
                collateral — the Branding &amp; Collateral step is skipped. Location
                {openKind === 'online' ? ' is the meeting link you set' : ' is Higher Ground'} and
                registration is open to students from any school.
              </p>
            </div>
          ) : (
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
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Class type <span className="text-red-500" title="Required">*</span>
            </label>
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
              {/* PL-176: inactive instructors never appear in new-scheduling
                  pickers — the already-assigned one stays selectable so an
                  existing class doesn't silently lose its instructor. */}
              {instructors
                .filter((i) => i.active || i.id === instructorId)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name ? `${i.name} (${i.email})` : i.email}
                    {!i.active ? ' — inactive' : ''}
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
              Price (USD) <span className="text-red-500" title="Required">*</span>
            </label>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="750" className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Student capacity <span className="text-red-500" title="Required">*</span>
            </label>
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
            {/* PL-287: one name everywhere — "Registration deadline" is what
                the flyer prints and what the roster surfaces. */}
            <label className="block text-sm font-medium text-gray-700">Registration deadline</label>
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
            <label className="block text-sm font-medium text-gray-700">Registration closes (sign-up cutoff)</label>
            <input type="date" value={registrationClose} onChange={(e) => setRegistrationClose(e.target.value)} className={inputCls} />
            <DateHint value={registrationClose} />
            <p className="text-xs text-gray-500 mt-1">
              The automatic cutoff — the register page stops taking sign-ups after this. Blank =
              first session. Set later to allow mid-class joins. Decisions run on the registration
              deadline above.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default location</label>
            <input
              type="text"
              value={defaultLocation}
              onChange={(e) => setDefaultLocation(e.target.value)}
              placeholder={
                deliveryMode === 'online'
                  ? "Blank = instructor's default meeting link"
                  : isOpen
                    ? 'Higher Ground — set the room/address'
                    : 'Blank = counselor gets asked 14 days out'
              }
              className={inputCls}
            />
            {/* PL-68: live preview of the exact email sentence — a hint, never
                blocking; whoever types the value words it to fit. */}
            {defaultLocation.trim() && (
              <p className="text-xs text-gray-500 mt-1">
                Families will see: &ldquo;{classLocationSentence(defaultLocation, deliveryMode)}&rdquo;
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Synap group</label>
            <input type="url" value={synapGroup} onChange={(e) => setSynapGroup(e.target.value)} placeholder="https://…" className={inputCls} />
          </div>

          {/* PL-317: no-school flavors set the class timezone HERE — online
              picks explicitly (the PL-233 picker); at-HGL is fixed Denver.
              School classes read the school record and never see this. */}
          {openKind === 'online' && (
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-gray-700">
                Class timezone{' '}
                <span className="font-normal text-xs text-gray-500">
                  — every session time, deadline, and email speaks this zone
                </span>
              </label>
              <div className="mt-1">
                <TimezoneSelect value={openTimezone} onChange={setOpenTimezone} />
              </div>
              {/* PL-353: the PUBLIC label for those times — city names
                  families recognize, never the zone id's city. */}
              <label className="block text-sm font-medium text-gray-700 mt-3">
                Cities shown with the times{' '}
                <span className="font-normal text-xs text-gray-500">
                  — optional, comma-separated (&ldquo;Milan, Munich&rdquo;); blank = the
                  timezone&apos;s own city
                </span>
              </label>
              <input
                type="text"
                value={displayCities}
                onChange={(e) => setDisplayCities(e.target.value)}
                placeholder="Milan, Munich, Cape Town"
                className={inputCls}
              />
            </div>
          )}
          {openKind === 'hgl' && (
            <p className="col-span-2 text-xs text-gray-500">
              Class timezone: <span className="font-semibold">America/Denver</span> (fixed — the
              class meets at Higher Ground in Salt Lake City)
            </p>
          )}
          {/* PL-310: ONE switch — a class with diagnostics runs them through
              Synap (or similar), so a separate Synap toggle modeled a
              distinction that doesn't exist. The email sequence conditions
              on this (editable later on the roster). */}
          <div className="col-span-2 flex flex-wrap gap-6 text-sm text-gray-700 border border-gray-200 rounded-md p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hasDiagnostics}
                onChange={(e) => setHasDiagnostics(e.target.checked)}
              />
              <span>
                <span className="font-semibold">Has diagnostics</span>{' '}
                <span className="text-xs text-gray-500">
                  (off = the email sequence drops all diagnostic and Synap content — no promises,
                  reminders, due dates, or access links)
                </span>
              </span>
            </label>
            {/* PL-311: only open-enrollment classes can be a follow-up. */}
            {isOpen && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isFollowOn}
                  onChange={(e) => setIsFollowOn(e.target.checked)}
                />
                <span>
                  <span className="font-semibold">This is a follow-up class</span>{' '}
                  <span className="text-xs text-gray-500">
                    (marketed to students finishing a feeder class — unlocks the marketing
                    controls on the roster card)
                  </span>
                </span>
              </label>
            )}
          </div>

          {/* PL-237: collateral moved to its own step (Sessions → Branding &
              Collateral → Review). */}
        </div>
      )}

      {step === 3 && (
        <div>
          {school && (
            <p className="text-xs text-gray-500 mb-3">
              All times in <span className="font-semibold">{school.timezone}</span>{' '}(from the
              school record, read-only)
            </p>
          )}
          {isOpen && (
            <p className="text-xs text-gray-500 mb-3">
              All times in <span className="font-semibold">{classTimezone}</span>{' '}(the class
              timezone from the Details step)
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
            <>
            {/* PL-329: select-all + the bulk panel when anything's checked. */}
            <label className="flex items-center gap-2 text-xs text-gray-500 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bulkSelected.size === sessions.length && sessions.length > 0}
                onChange={(e) =>
                  setBulkSelected(e.target.checked ? new Set(sessions.map((_, j) => j)) : new Set())
                }
              />
              Select all {sessions.length} session{sessions.length === 1 ? '' : 's'}
              {bulkSelected.size > 0 && ` — ${bulkSelected.size} selected`}
            </label>
            {bulkSelected.size > 0 && (
              <div className="border border-hgl-blue/40 bg-blue-50 rounded-md p-3 mb-3 grid grid-cols-4 gap-3 items-start text-sm">
                <div>
                  <label className="block text-xs text-gray-600">Start (24h) — blank keeps</label>
                  <div className="mt-1">
                    <TimeSelect value={bulkStart} onChange={setBulkStart} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-600">End (24h) — blank keeps</label>
                  <div className="mt-1">
                    <TimeSelect value={bulkEnd} onChange={setBulkEnd} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-600">Location — blank keeps</label>
                  <input
                    type="text"
                    value={bulkLocation}
                    onChange={(e) => setBulkLocation(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded p-1.5"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600">Shift dates by (days)</label>
                  <input
                    type="number"
                    step="1"
                    placeholder="0"
                    value={bulkShiftDays}
                    onChange={(e) => setBulkShiftDays(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded p-1.5"
                  />
                </div>
                <div className="col-span-4 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!bulkStart && !bulkEnd && !bulkLocation.trim() && !Number(bulkShiftDays)}
                    onClick={() => {
                      const shift = Number(bulkShiftDays) || 0
                      setSessions((prev) =>
                        prev.map((x, j) =>
                          bulkSelected.has(j)
                            ? {
                                ...x,
                                ...(bulkStart ? { start_time: bulkStart } : {}),
                                ...(bulkEnd ? { end_time: bulkEnd } : {}),
                                ...(bulkLocation.trim() ? { location: bulkLocation.trim() } : {}),
                                ...(shift && x.session_date
                                  ? { session_date: addDays(x.session_date, shift) }
                                  : {}),
                              }
                            : x
                        )
                      )
                      setBulkSelected(new Set())
                      setBulkStart('')
                      setBulkEnd('')
                      setBulkLocation('')
                      setBulkShiftDays('')
                    }}
                    className="bg-hgl-slate text-white py-1.5 px-4 rounded font-bold hover:opacity-90 disabled:opacity-50"
                  >
                    Apply to {bulkSelected.size} session{bulkSelected.size === 1 ? '' : 's'}
                  </button>
                  <span className="text-xs text-gray-500">
                    Blank fields keep each session&apos;s current value.
                  </span>
                </div>
              </div>
            )}
            <ul className="space-y-2 mb-4">
              {sorted.map((s, i) => (
                <li
                  key={`${s.session_date}-${i}`}
                  className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2"
                >
                  <input
                    type="checkbox"
                    className="mr-2 shrink-0"
                    checked={bulkSelected.has(sessions.indexOf(s))}
                    onChange={(e) => {
                      const idx = sessions.indexOf(s)
                      setBulkSelected((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(idx)
                        else next.delete(idx)
                        return next
                      })
                    }}
                  />
                  {editIdx === sessions.indexOf(s) && editDraft ? (
                    /* PL-316: fix one session in place — same pickers as the
                       add form; no more remove + re-add. */
                    <span className="w-full grid grid-cols-4 gap-2 items-start">
                      <span>
                        <input
                          type="date"
                          value={editDraft.session_date}
                          onChange={(e) => setEditDraft({ ...editDraft, session_date: e.target.value })}
                          className="w-full border border-gray-300 rounded p-1"
                        />
                        <DateHint value={editDraft.session_date} />
                      </span>
                      <TimeSelect
                        value={editDraft.start_time}
                        onChange={(v) => setEditDraft({ ...editDraft, start_time: v })}
                      />
                      <TimeSelect
                        value={editDraft.end_time}
                        onChange={(v) => setEditDraft({ ...editDraft, end_time: v })}
                      />
                      <span className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editDraft.location}
                          onChange={(e) => setEditDraft({ ...editDraft, location: e.target.value })}
                          placeholder={defaultLocation || 'location'}
                          className="w-full border border-gray-300 rounded p-1"
                        />
                        <button
                          type="button"
                          disabled={!editDraft.session_date}
                          onClick={() => {
                            const idx = editIdx
                            setSessions((prev) => prev.map((x, j) => (j === idx ? { ...editDraft } : x)))
                            setEditIdx(null)
                            setEditDraft(null)
                          }}
                          className="text-hgl-blue text-xs font-semibold hover:underline disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditIdx(null)
                            setEditDraft(null)
                          }}
                          className="text-gray-500 text-xs hover:underline"
                        >
                          cancel
                        </button>
                      </span>
                    </span>
                  ) : (
                    <>
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
                      <span className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditIdx(sessions.indexOf(s))
                            setEditDraft({ ...s })
                          }}
                          className="text-hgl-blue text-xs hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSession(sessions.indexOf(s))}
                          className="text-red-600 text-xs hover:underline"
                        >
                          Remove
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            </>
          )}

          {sessionError && (
            <p className="text-sm text-red-600 font-semibold mb-2">{sessionError}</p>
          )}
          {/* PL-251: items-start, not items-end — bottom-aligning let the
              DateHint under the date input push that input above Start/End. */}
          <div className="border border-gray-200 rounded-md p-4 grid grid-cols-4 gap-3 items-start text-sm">
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
              className="self-end bg-hgl-slate text-white py-1.5 px-3 rounded hover:opacity-90 disabled:opacity-50"
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

      {/* PL-237: Branding & Collateral — its own step between Sessions and
          Review, mirroring the class card's collateral panel. Skippable:
          "Skip" just moves on; "Skip for now" also queues a state-driven
          Needs Attention reminder. */}
      {step === 4 && (
        <div className="space-y-5">
          <p className="text-xs text-gray-500">
            Everything here drives the generated flyer and parent letter (downloads unlock once
            the class is created). Finish it now, or skip and complete it later under Classes →
            Branding &amp; collateral.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">hgl.co short link</label>
              <input
                type="text"
                value={shortLink}
                onChange={(e) => setShortLink(e.target.value)}
                placeholder="hgl.link/…"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Language of generated files</label>
              <select value={collateralLang} onChange={(e) => setCollateralLang(e.target.value)} className={selectCls}>
                <option value="">School default</option>
                <option value="en">English only</option>
                <option value="es">Spanish only</option>
                <option value="both">Both (separate EN + ES files)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Practice tests included <span className="text-red-500" title="Required">*</span>
              </label>
              <input
                type="number"
                min={0}
                value={practiceTestCount}
                onChange={(e) => setPracticeTestCount(e.target.value)}
                placeholder="e.g. 2"
                className={inputCls}
              />
              {/* PL-239: defaulted so the create can never fail on it. */}
              <p className="text-xs text-gray-500 mt-1">
                Defaults to 2 — change it any time here or on the collateral card.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Flyer intro sentence</label>
              <textarea
                value={flyerBlurb}
                onChange={(e) => setFlyerBlurb(e.target.value)}
                rows={2}
                placeholder="Blank = the standard default sentence"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Extra letter paragraph (English)</label>
              <textarea
                value={letterBlurb}
                onChange={(e) => setLetterBlurb(e.target.value)}
                rows={2}
                placeholder="Optional — added to the parent letter"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Extra letter paragraph (Spanish)</label>
              <textarea
                value={letterBlurbEs}
                onChange={(e) => setLetterBlurbEs(e.target.value)}
                rows={2}
                placeholder="Optional — used on the Spanish letter"
                className={inputCls}
              />
            </div>
            {/* PL-348: the public class page's hero bullets. Facts like
                price and deadline render from the class record — these
                bullets are the selling points only. */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Public page selling bullets (one per line)
              </label>
              <textarea
                value={sellingBullets}
                onChange={(e) => setSellingBullets(e.target.value)}
                rows={5}
                placeholder={'16 hours of instruction with an expert instructor\nSmall group size\n…'}
                className={inputCls}
              />
              <p className="text-xs text-gray-500 mt-1">
                Shown at the top of the public class page (/c/{'{'}slug{'}'}). Price and the
                registration deadline appear there automatically — don&apos;t type them here.{' '}
                {sellingBullets.trim() === '' && (
                  <button
                    type="button"
                    className="text-hgl-blue underline"
                    onClick={() => {
                      // Prefill from the class details on this wizard — all
                      // facts, no invented claims; every line is editable.
                      const totalMinutes = sessions.reduce((s, x) => {
                        const [sh, sm] = (x.start_time || '').split(':').map(Number)
                        const [eh, em] = (x.end_time || '').split(':').map(Number)
                        const d = (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0))
                        return s + (Number.isFinite(d) && d > 0 ? d : 0)
                      }, 0)
                      const hours = Math.round(totalMinutes / 60)
                      const tests = Math.trunc(Number(practiceTestCount)) || 0
                      setSellingBullets(
                        [
                          hours > 0 ? `${hours} hours of instruction with an expert instructor` : 'Expert live instruction',
                          capacity.trim() ? `Small group size (${capacity.trim()} or fewer students)` : null,
                          tests > 0 ? `${tests} full-length digital diagnostic exam${tests === 1 ? '' : 's'} with detailed score reports` : null,
                          '1 free personalized 30-minute strategy session per student',
                          'Curriculum workbook with integrated practice problems',
                        ]
                          .filter(Boolean)
                          .join('\n')
                      )
                    }}
                  >
                    Suggest bullets from the class details
                  </button>
                )}
              </p>
            </div>
            {/* PL-355 D: the prerequisite line, right where the bullets
                render on the public page. */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Public page prerequisite line (optional)
              </label>
              <input
                type="text"
                value={prerequisiteNote}
                onChange={(e) => setPrerequisiteNote(e.target.value)}
                placeholder="e.g. For students who've completed an HGL SAT Prep class"
                className={inputCls}
              />
              <p className="text-xs text-gray-500 mt-1">
                Renders as &ldquo;Prerequisite: …&rdquo; under the bullets — mainly for follow-up
                classes.
              </p>
            </div>
          </div>

          <fieldset className="border border-gray-200 rounded-lg p-4">
            <legend className="text-sm font-semibold text-hgl-slate px-1">Promo (optional)</legend>
            <p className="text-xs text-gray-500 mb-3">
              All three together or none. The flyer prints the code and savings; remember the
              matching Stripe promotion code is set up separately in Stripe.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Promo code</label>
                <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="EARLY50" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Savings (USD)</label>
                <input type="number" value={promoAmount} onChange={(e) => setPromoAmount(e.target.value)} placeholder="50" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Promo deadline</label>
                <input type="date" value={promoDeadline} onChange={(e) => setPromoDeadline(e.target.value)} className={inputCls} />
                <DateHint value={promoDeadline} />
              </div>
            </div>
          </fieldset>

          {school && (
            <fieldset className="border border-gray-200 rounded-lg p-4">
              <legend className="text-sm font-semibold text-hgl-slate px-1">
                {school.nickname} branding
              </legend>
              <p className="text-xs text-gray-500 mb-3">
                School-level defaults on the school record itself (also editable under Classes →
                Schools) — the flyer&apos;s logo and accent, and the school&apos;s default language.
                Saved separately from the class.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <label className="text-xs text-hgl-blue underline cursor-pointer">
                  upload / replace logo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      setBrandingMsg('')
                      const body = new FormData()
                      body.set('schoolId', school.id)
                      body.set('file', file)
                      const res = await fetch('/api/admin/school-logo', { method: 'POST', body })
                      setBrandingMsg(res.ok ? 'Logo updated (background removed automatically).' : 'Error uploading the logo.')
                      if (res.ok) onSchoolsChange()
                    }}
                  />
                </label>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-600">Accent</label>
                  <input
                    type="color"
                    value={schoolAccent || '#00AEEE'}
                    onChange={(e) => setSchoolAccent(e.target.value)}
                    className="h-7 w-9 border border-gray-300 rounded cursor-pointer"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-600">School default language</label>
                  <select
                    value={schoolLanguage}
                    onChange={(e) => setSchoolLanguage(e.target.value)}
                    className="border rounded p-1 text-xs bg-white"
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setBrandingMsg('')
                    const { error } = await supabase
                      .from('schools')
                      .update({ accent_color: schoolAccent || null, collateral_language: schoolLanguage })
                      .eq('id', school.id)
                    setBrandingMsg(error ? 'Error: ' + error.message : 'School branding saved.')
                    if (!error) onSchoolsChange()
                  }}
                  className="bg-hgl-slate text-white text-xs font-bold px-3 py-1.5 rounded hover:opacity-90"
                >
                  Save school branding
                </button>
                {brandingMsg && (
                  <span className={`text-xs font-semibold ${brandingMsg.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
                    {brandingMsg}
                  </span>
                )}
              </div>
            </fieldset>
          )}

          <div className="flex gap-3 text-sm">
            <button
              type="button"
              onClick={() => {
                setSkipForNow(false)
                setStep(5)
              }}
              className="text-gray-500 underline"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => {
                setSkipForNow(true)
                setStep(5)
              }}
              className="text-amber-700 underline font-semibold"
              title="Creates a Needs Attention reminder that clears itself once the collateral is completed"
            >
              Skip for now (remind me later)
            </button>
          </div>
        </div>
      )}

      {step === 5 && !isOpen && school && skipForNow && (
        <p className="mb-4 p-2.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
          Collateral skipped for now — after the class is created, a &quot;Collateral not set
          up&quot; reminder will sit on the dashboard until the fields are completed under
          Classes → Branding &amp; collateral.
        </p>
      )}
      {step === 5 && (school || isOpen) && (
        <div className="grid grid-cols-2 gap-8">
          <div className="text-sm space-y-1.5">
            <h3 className="font-bold text-hgl-slate text-base mb-2">
              {school ? `${school.nickname} — ${classType}` : `Open enrollment — ${classType}`}
              {isOpen && (
                <span className="ml-2 text-xs font-semibold text-hgl-blue align-middle">
                  {openKind === 'online' ? 'online, any school' : 'in person at Higher Ground'}
                </span>
              )}
            </h3>
            <p>
              <span className="text-gray-500">Instructor:</span>{' '}
              {instructor
                ? `${instructor.name ?? instructor.email} (${instructor.email})`
                : 'Not yet assigned — the scheduling nudge fires once enrollment reaches minimum'}
            </p>
            <p>
              <span className="text-gray-500">School contact:</span>{' '}
              {isOpen
                ? 'none — open enrollment (no counselor emails, no classroom request, no collateral)'
                : counselorId
                  ? (() => {
                      const c = schoolContacts.find((x) => x.id === counselorId)
                      return c ? `${c.first_name} ${c.last_name} (${c.email})` : '—'
                    })()
                  : 'all school contacts'}
            </p>
            <p><span className="text-gray-500">Starts:</span> {startDate ? formatDateAdmin(startDate) : '—'}</p>
            <p><span className="text-gray-500">Price:</span> ${Number(price || 0).toLocaleString()} · <span className="text-gray-500">Capacity:</span> {capacity} · <span className="text-gray-500">Min:</span> {minEnrollment}</p>
            <p><span className="text-gray-500">Mode:</span> {deliveryMode === 'online' ? 'Online' : 'In person'}</p>
            <p>
              <span className="text-gray-500">Timezone:</span>{' '}
              {school ? `${school.timezone} (from the school record)` : `${classTimezone} (class timezone — open enrollment)`}
            </p>
            <p>
              <span className="text-gray-500">Location:</span>{' '}
              {defaultLocation.trim() ||
                (deliveryMode === 'online'
                  ? (instructor?.default_meeting_link ??
                    (instructor
                      ? 'instructor has no default link — set later'
                      : 'set when the instructor is assigned'))
                  : isOpen
                    ? 'blank — set it before the class-details email'
                    : 'blank — counselor gets asked 14 days out')}
            </p>
            <p><span className="text-gray-500">Registration deadline:</span> {enrollmentDeadline ? formatDateAdmin(enrollmentDeadline) : 'default (registration close, or the first session)'}</p>
            <p><span className="text-gray-500">Registration closes (sign-up cutoff):</span> {registrationClose ? formatDateAdmin(registrationClose) : 'first session (default)'}</p>
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
          onClick={() =>
            setStep((s) => {
              if (s === 1) return s
              // PL-274: open enrollment skips Branding & Collateral entirely.
              if (isOpen && s === 5) return 3
              return (s - 1) as 1 | 2 | 3 | 4
            })
          }
          disabled={step === 1}
          className="text-sm text-gray-500 underline hover:text-hgl-slate disabled:opacity-0"
        >
          ← Back
        </button>
        {step < 5 ? (
          <div className="text-right">
            <button
              type="button"
              onClick={() =>
                setStep((s) => {
                  // PL-274: open enrollment skips Branding & Collateral.
                  if (isOpen && s === 3) return 5
                  return (s + 1) as 2 | 3 | 4 | 5
                })
              }
              disabled={stepNeeds.length > 0}
              className="bg-hgl-blue text-white font-bold py-2.5 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50"
            >
              Next →
            </button>
            {/* PL-239: a greyed-out Next says WHY, live, right under it. */}
            {stepNeeds.length > 0 && (
              <p className="text-xs text-amber-700 mt-1.5 max-w-sm">
                Next needs: {stepNeeds.join(' · ')}
              </p>
            )}
          </div>
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
          {/* PL-239: when the error names a fixable field, one click lands
              on its step. */}
          {messageStep != null && (
            <button
              type="button"
              onClick={() => {
                setStep(messageStep)
                setMessage('')
                setMessageStep(null)
              }}
              className="block mx-auto mt-1.5 text-sm underline font-semibold"
            >
              Go to the {steps[messageStep - 1]} step to fix it →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
