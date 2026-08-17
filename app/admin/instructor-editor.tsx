'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { GOOGLE_CALENDAR_PALETTE, textOnColor } from '../utils/calendar-colors'
import { TimezoneSelect } from './ui'
import { WEEKDAYS } from './tutoring/types'
import type { OfferWindowUI } from './tutoring/types'
import { groupSubjects } from '../utils/subject-groups'
import { imageAttrs, parseClassPageImage } from '../utils/class-page-images'

// PL-226: THE instructor add/edit surface (instructors = tutors — one table,
// one profile). Lives on Contacts→Instructors; the 1-on-1→Tutors panel is a
// read-only representation + finder that points here. Grown from the old
// tutors-panel TutorEditor (that editor moved here, plus identity fields:
// name, email, phone, and a plain-English email-change warning — email is
// the login identity, the instructor-RLS key, and, when no calendar id is
// set, the Google-calendar push target).

/* eslint-disable @typescript-eslint/no-explicit-any */

type SubjectRow = { id: string; name: string; category: string }

// PL-358: the headshot upload/replace/remove control — same staff-gated
// image route as the class-page images (target 'instructor-headshot').
function HeadshotControl({
  instructorId,
  headshot,
  onChanged,
}: {
  instructorId: string
  headshot: unknown
  onChanged: (next: unknown) => void
}) {
  const img = parseClassPageImage(headshot)
  const [alt, setAlt] = useState(img?.alt ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [msg, setMsg] = useState('')

  async function call(init: RequestInit): Promise<{ ok: boolean; image?: unknown }> {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/site-content/image', init)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(json.error ?? 'That change failed.')
        return { ok: false }
      }
      return { ok: true, image: json.image ?? null }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-3 text-xs">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageAttrs(img).src} alt={img.alt} className="w-16 h-16 rounded-full object-cover border border-gray-200" />
      ) : (
        <span className="text-gray-400 italic self-center">no headshot — the team page shows initials</span>
      )}
      <div className="flex-1 min-w-56 space-y-1.5">
        <input
          type="text"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Alt text (required), e.g. Portrait of Eric Brown"
          className="w-full border border-gray-300 rounded p-1.5"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className={`underline cursor-pointer ${alt.trim() ? 'text-hgl-blue' : 'text-gray-400 cursor-not-allowed'}`}>
            {img ? 'replace headshot' : 'upload headshot'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={busy || !alt.trim()}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const body = new FormData()
                body.set('target', 'instructor-headshot')
                body.set('classId', instructorId)
                body.set('file', f)
                body.set('alt', alt)
                const r = await call({ method: 'POST', body })
                if (r.ok) onChanged(r.image)
              }}
            />
          </label>
          {img && !confirmRemove && (
            <button type="button" onClick={() => setConfirmRemove(true)} disabled={busy} className="text-red-600 underline">
              remove…
            </button>
          )}
        </div>
        {confirmRemove && (
          <div className="bg-red-50 border border-red-200 rounded p-2 space-x-2">
            <span className="text-red-900">Remove the headshot? The team page shows initials instead.</span>
            <button
              type="button"
              onClick={async () => {
                const r = await call({
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ target: 'instructor-headshot', classId: instructorId }),
                })
                if (r.ok) {
                  setConfirmRemove(false)
                  onChanged(null)
                }
              }}
              disabled={busy}
              className="font-bold text-red-700 underline"
            >
              Remove it
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)} disabled={busy} className="text-gray-600 underline">
              Keep it
            </button>
          </div>
        )}
        {msg && <p className="text-red-600">{msg}</p>}
      </div>
    </div>
  )
}

export default function InstructorEditor({
  instructorId,
  onClose,
}: {
  /** null = create a new instructor. */
  instructorId: string | null
  onClose: (changed: boolean) => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [originalEmail, setOriginalEmail] = useState('')
  // PL-332: the admin profiles (email + name) — a manager's pref controls go
  // read-only when the instructor row belongs to one (a DB trigger refuses
  // the write regardless of this screen).
  const [adminList, setAdminList] = useState<{ email: string; name: string | null }[]>([])

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  // PL-274 F: family-facing intro paragraph for open-class details emails.
  const [bio, setBio] = useState('')
  // PL-358: the public profile — /team and the class pages render from these.
  // PL-365: public_name = what the public pages display; the row name stays
  // internal (timecards/QBO matching).
  const [publicName, setPublicName] = useState('')
  const [credential, setCredential] = useState('')
  // PL-372: the line under the name on class-page cards (schools list).
  const [classesDisplayLine, setClassesDisplayLine] = useState('')
  const [showOnTeam, setShowOnTeam] = useState(false)
  const [teamOrder, setTeamOrder] = useState('')
  const [featuredOnClasses, setFeaturedOnClasses] = useState(false)
  const [headshot, setHeadshot] = useState<unknown>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [pickedPrep, setPickedPrep] = useState<string[]>([])
  const [timezone, setTimezone] = useState('America/Denver')
  // PL-327: email preferences (admin/staff override; tutors self-serve the
  // same three from their portal).
  const [prefNotes, setPrefNotes] = useState<'on' | 'weekly' | 'off'>('on')
  const [prefDigests, setPrefDigests] = useState<'on' | 'weekly' | 'off'>('on')
  const [prefFyi, setPrefFyi] = useState(true)
  const [calendarId, setCalendarId] = useState('')
  // PL-283: per-tutor calendar color ('' = auto-assigned).
  const [calendarColor, setCalendarColor] = useState('')
  const [location, setLocation] = useState('')
  const [windows, setWindows] = useState<OfferWindowUI[]>([])
  const [payTitles, setPayTitles] = useState<string[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [payType, setPayType] = useState<'hourly' | 'salaried'>('hourly')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      const [{ data: subj }, { data: auth }] = await Promise.all([
        supabase.from('subjects').select('id, name, category').order('category').order('name'),
        supabase.auth.getUser(),
      ])
      setSubjects((subj as SubjectRow[]) ?? [])
      if (auth.user) {
        const { data: p } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single()
        setIsAdmin(p?.role === 'admin')
        // PL-332: managers can't read other profiles rows — the staff-gated
        // route reports who the owners are.
        if (p?.role !== 'admin') {
          try {
            const res = await fetch('/api/admin/instructor-comms')
            const j = await res.json().catch(() => null)
            setAdminList(j?.admins ?? [])
          } catch {
            setAdminList([])
          }
        }
      }
      if (instructorId) {
        const [{ data: row }, { data: noteRow }] = await Promise.all([
          supabase
            .from('instructors')
            .select(
              `id, email, name, phone, bio, subjects, subjects_with_prep, timezone, google_calendar_id,
               default_meeting_link, offer_windows, pay_type_titles, pay_type, calendar_color,
               pref_notes_reminders, pref_class_digests, pref_fyi_copies,
               credential, public_name, classes_display_line, show_on_team, team_order, featured_on_classes, headshot`
            )
            .eq('id', instructorId)
            .maybeSingle(),
          supabase.from('tutor_notes').select('notes').eq('instructor_id', instructorId).maybeSingle(),
        ])
        if (row) {
          setName(row.name ?? '')
          setEmail(row.email ?? '')
          setOriginalEmail(row.email ?? '')
          setPhone(row.phone ?? '')
          setBio((row as { bio?: string | null }).bio ?? '')
          setCredential((row as any).credential ?? '')
          setPublicName((row as any).public_name ?? '')
          setClassesDisplayLine((row as any).classes_display_line ?? '')
          setShowOnTeam((row as any).show_on_team === true)
          setTeamOrder((row as any).team_order != null ? String((row as any).team_order) : '')
          setFeaturedOnClasses((row as any).featured_on_classes === true)
          setHeadshot((row as any).headshot ?? null)
          setPicked((row.subjects as string[]) ?? [])
          setPickedPrep((row.subjects_with_prep as string[]) ?? [])
          setTimezone(row.timezone ?? 'America/Denver')
          setPrefNotes(((row as any).pref_notes_reminders as 'on' | 'weekly' | 'off') ?? 'on')
          setPrefDigests(((row as any).pref_class_digests as 'on' | 'weekly' | 'off') ?? 'on')
          setPrefFyi((row as any).pref_fyi_copies !== false)
          setCalendarId(row.google_calendar_id ?? '')
          setCalendarColor((row as { calendar_color?: string | null }).calendar_color ?? '')
          setLocation(row.default_meeting_link ?? '')
          setWindows((row.offer_windows as OfferWindowUI[]) ?? [])
          setPayTitles((row.pay_type_titles as string[]) ?? [])
          setPayType((row.pay_type as any) ?? 'hourly')
        }
        setNotes(noteRow?.notes ?? '')
      }
      setLoaded(true)
    })()
  }, [instructorId])

  const emailChanged = instructorId != null && email.trim().toLowerCase() !== originalEmail.toLowerCase()
  // PL-332: this instructor row belongs to an admin profile, and the caller
  // is a manager — email-pref controls are read-only and excluded from save.
  const prefOwner = isAdmin
    ? null
    : (adminList.find((a) => a.email === originalEmail.trim().toLowerCase()) ?? null)

  async function save() {
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) {
      setError('An email address is required — it is how they sign in.')
      return
    }
    if (windows.some((w) => !w.start_time || !w.end_time || w.end_time <= w.start_time)) {
      setError('Each offer window needs a start time before its end time.')
      return
    }
    setSaving(true)
    setError('')
    const fields = {
      email: cleanEmail,
      name: name.trim() || null,
      phone: phone.trim() || null,
      bio: bio.trim() || null,
      // PL-358: public-profile fields (headshot saves via its own upload
      // control, not here).
      credential: credential.trim() || null,
      public_name: publicName.trim() || null,
      classes_display_line: classesDisplayLine.trim() || null,
      show_on_team: showOnTeam,
      team_order: teamOrder.trim() === '' ? null : Math.trunc(Number(teamOrder)),
      featured_on_classes: featuredOnClasses,
      subjects: picked,
      subjects_with_prep: pickedPrep,
      timezone: timezone || 'America/Denver',
      google_calendar_id: calendarId.trim() || null,
      calendar_color: calendarColor || null,
      default_meeting_link: location.trim() || null,
      offer_windows: windows,
      // PL-332: an admin-owned instructor's email prefs are the owner's —
      // excluded from a manager's save (the DB trigger refuses them anyway).
      ...(prefOwner
        ? {}
        : {
            pref_notes_reminders: prefNotes,
            pref_class_digests: prefDigests,
            pref_fyi_copies: prefFyi,
          }),
      // Managers must not touch titles or the pay-type flag (the DB trigger
      // refuses the whole update) — only include when the caller may edit.
      ...(isAdmin ? { pay_type_titles: payTitles, pay_type: payType } : {}),
    }
    let id = instructorId
    if (id) {
      const { error: e1 } = await supabase.from('instructors').update(fields).eq('id', id)
      if (e1) {
        setError('Error: ' + (e1.code === '23505' ? 'that email is already an instructor.' : e1.message))
        setSaving(false)
        return
      }
    } else {
      const { data: inserted, error: e1 } = await supabase
        .from('instructors')
        .insert([fields])
        .select('id')
        .single()
      if (e1 || !inserted) {
        setError('Error: ' + (e1?.code === '23505' ? 'that email is already an instructor.' : e1?.message))
        setSaving(false)
        return
      }
      id = inserted.id
    }
    const { error: e2 } = await supabase
      .from('tutor_notes')
      .upsert({ instructor_id: id, notes: notes.trim() || null, updated_at: new Date().toISOString() })
    if (e2) {
      setError('Error: ' + e2.message)
      setSaving(false)
      return
    }
    onClose(true)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-hgl-slate">
          {instructorId ? `${name || email || 'Instructor'} — profile` : 'Add an instructor'}
        </h3>
        {!loaded ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 font-semibold mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md p-2"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 font-semibold mb-1">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (505) 555-0100"
                  className="w-full border border-gray-300 rounded-md p-2"
                />
              </div>
            </div>

            {/* PL-274 F: FAMILY-FACING (unlike the matching notes below) —
                composed into open-class details emails as {instructorBio}.
                Empty = the paragraph drops cleanly. */}
            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Bio — families see this
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                placeholder='e.g. "Eric is a graduate of Princeton University and has taught SAT prep at Higher Ground Learning since 2010. He is also our Executive Director and the creator of this course."'
                className="w-full border border-gray-300 rounded-md p-2 text-sm"
              />
              <p className="text-[11px] text-gray-500 mt-0.5">
                Appears as the instructor introduction in open-enrollment class emails. Leave blank
                to skip the paragraph entirely. It&apos;s also the bio on the public team page when
                &ldquo;Show on the team page&rdquo; is on below.
              </p>
            </div>

            {/* PL-358: the PUBLIC profile — the /team page and the class
                pages' instructor cards render from these fields (one
                source; nothing is hand-curated elsewhere). */}
            <fieldset className="border border-gray-200 rounded-lg p-3">
              <legend className="text-xs font-semibold text-hgl-slate px-1">
                Public profile — the team page &amp; class pages render from this
              </legend>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-600 font-semibold mb-1">
                    Public display name
                  </label>
                  <input
                    value={publicName}
                    onChange={(e) => setPublicName(e.target.value)}
                    placeholder={name.trim() ? `blank = "${name.trim()}"` : 'blank = the name above'}
                    className="w-full border border-gray-300 rounded-md p-2 text-sm"
                  />
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Shown on the team page &amp; class pages. The name above stays as-is
                    everywhere internal (timecards, payroll matching).
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 font-semibold mb-1">
                    Credential line
                  </label>
                  <input
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    placeholder='e.g. "International SAT, Math"'
                    className="w-full border border-gray-300 rounded-md p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 font-semibold mb-1">
                    Order on the team page
                  </label>
                  <input
                    type="number"
                    value={teamOrder}
                    onChange={(e) => setTeamOrder(e.target.value)}
                    placeholder="blank = after the ordered ones"
                    className="w-full border border-gray-300 rounded-md p-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-5 mt-2 text-sm text-gray-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={showOnTeam} onChange={(e) => setShowOnTeam(e.target.checked)} />
                  Show on the team page
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={featuredOnClasses}
                    onChange={(e) => setFeaturedOnClasses(e.target.checked)}
                  />
                  Feature on the class pages&apos; instructors section
                </label>
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-600 font-semibold mb-1">
                  Shown under the name on class pages
                </label>
                <input
                  value={classesDisplayLine}
                  onChange={(e) => setClassesDisplayLine(e.target.value)}
                  placeholder='e.g. "ASF · ISD" — blank shows the credential line'
                  className="w-full border border-gray-300 rounded-md p-2 text-sm"
                />
                <p className="text-[11px] text-gray-500 mt-0.5">
                  The team page always shows the credential line; this only changes the class
                  pages&apos; featured cards.
                </p>
              </div>
              <div className="mt-3">
                {instructorId ? (
                  <HeadshotControl
                    instructorId={instructorId}
                    headshot={headshot}
                    onChanged={(h) => setHeadshot(h)}
                  />
                ) : (
                  <p className="text-xs text-gray-500 italic">
                    Save the new instructor first, then upload their headshot here.
                  </p>
                )}
              </div>
            </fieldset>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Email — how they sign in
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-md p-2"
              />
              {emailChanged && (
                <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                  <p className="font-semibold">Changing the email moves their whole identity:</p>
                  <p>
                    · They sign in with the NEW address from now on — the old address can&apos;t
                    open their portal anymore (any session it has loses access on its next page
                    load).
                  </p>
                  <p>
                    · Their own portal views (sessions, timecards, notes) follow the new address
                    automatically.
                  </p>
                  {!calendarId.trim() && (
                    <p>
                      · No Google calendar id is set, so sessions push to the calendar of the
                      email address itself — future pushes go to the NEW address&apos;s calendar.
                      Set an explicit calendar id below if their calendar should stay put.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Subjects{' '}
                <span className="font-normal text-gray-400">
                  — click to cycle: <span className="font-semibold text-hgl-slate">ready</span> →{' '}
                  <span className="font-semibold text-amber-700">with prep, confirm first</span>{' '}→ off.
                  Ready subjects auto-match in the wizard; with-prep ones never do.
                </span>
              </label>
              {/* PL-320: the same grouping the tutors table uses — one source. */}
              <div className="space-y-2">
                {groupSubjects(subjects.map((s) => ({ name: s.name, category: s.category }))).map(
                  (g) => (
                    <div key={g.group}>
                      <p className="text-xs font-semibold text-gray-500 mb-1">{g.group}</p>
                      <div className="flex flex-wrap gap-2">
                        {g.names.map((name) => {
                          const state = picked.includes(name) ? 'ready' : pickedPrep.includes(name) ? 'prep' : 'off'
                          const cycle = () => {
                            if (state === 'ready') {
                              setPicked((p) => p.filter((x) => x !== name))
                              setPickedPrep((p) => [...p, name])
                            } else if (state === 'prep') {
                              setPickedPrep((p) => p.filter((x) => x !== name))
                            } else {
                              setPicked((p) => [...p, name])
                            }
                          }
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={cycle}
                              className={`px-2 py-1 rounded border cursor-pointer text-xs ${
                                state === 'ready'
                                  ? 'bg-hgl-slate text-white border-hgl-slate'
                                  : state === 'prep'
                                    ? 'bg-amber-50 text-amber-800 border-amber-400'
                                    : 'bg-white text-gray-600 border-gray-300'
                              }`}
                              title={
                                state === 'ready'
                                  ? 'Ready — auto-matchable'
                                  : state === 'prep'
                                    ? 'Capable with prep — confirm with the tutor first, never auto-suggested'
                                    : 'Not offered'
                              }
                            >
                              {name}
                              {state === 'prep' ? ' *' : ''}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Email preferences{' '}
                <span className="font-normal text-gray-400">
                  — informational only; timecard, schedule-change, and coverage emails always send
                </span>
              </label>
              <div className={`flex flex-wrap gap-4 text-sm items-end ${prefOwner ? 'opacity-60' : ''}`}>
                <label className="block">
                  <span className="block text-xs text-gray-500">Session-note reminders</span>
                  <select value={prefNotes} disabled={!!prefOwner} onChange={(e) => setPrefNotes(e.target.value as 'on' | 'weekly' | 'off')} className="mt-1 border border-gray-300 rounded p-1.5 bg-white">
                    <option value="on">on (daily)</option>
                    <option value="weekly">weekly digest</option>
                    <option value="off">off</option>
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs text-gray-500">Class digests & milestone pings</span>
                  <select value={prefDigests} disabled={!!prefOwner} onChange={(e) => setPrefDigests(e.target.value as 'on' | 'weekly' | 'off')} className="mt-1 border border-gray-300 rounded p-1.5 bg-white">
                    <option value="on">on (digest + instant pings)</option>
                    <option value="weekly">weekly digest only</option>
                    <option value="off">off (calendar events stop too)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-1.5">
                  <input type="checkbox" checked={prefFyi} disabled={!!prefOwner} onChange={(e) => setPrefFyi(e.target.checked)} />
                  <span className="text-xs text-gray-600">FYI copies of family emails</span>
                </label>
              </div>
              {/* PL-332: the plain-English explainer where the control would be. */}
              {prefOwner && (
                <p className="text-[11px] text-gray-500 italic mt-1">
                  Only {prefOwner.name ?? prefOwner.email}{' '}can change an owner&apos;s
                  notifications.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">Timezone</label>
              <TimezoneSelect value={timezone} onChange={setTimezone} />
            </div>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Google calendar id (blank = their primary calendar, i.e. their email)
              </label>
              <input
                type="text"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                placeholder={email || 'their email'}
                className="w-full border border-gray-300 rounded-md p-2"
              />
            </div>

            {/* PL-283: matches Kelsie's Google Calendar color-coding — the
                same swatches Google offers, so portal calendars read like the
                calendar she already runs. */}
            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Calendar color — how this tutor&apos;s sessions show on portal calendars
              </label>
              <div className="flex flex-wrap gap-1.5 items-center">
                {GOOGLE_CALENDAR_PALETTE.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    onClick={() => setCalendarColor(p.hex)}
                    title={p.name}
                    className={`w-6 h-6 rounded-full border-2 ${
                      calendarColor.toUpperCase() === p.hex.toUpperCase()
                        ? 'border-hgl-slate ring-2 ring-hgl-slate/40'
                        : 'border-white shadow'
                    }`}
                    style={{ background: p.hex }}
                  >
                    {calendarColor.toUpperCase() === p.hex.toUpperCase() && (
                      <span className="text-[10px] font-bold" style={{ color: textOnColor(p.hex) }}>
                        ✓
                      </span>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCalendarColor('')}
                  className={`px-2 py-1 rounded border text-xs ${
                    calendarColor === ''
                      ? 'bg-hgl-slate text-white border-hgl-slate'
                      : 'bg-white text-gray-600 border-gray-300'
                  }`}
                >
                  Auto
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Auto picks a spare color from the same palette and keeps it stable for this tutor.
              </p>
            </div>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Offer windows — when the portal may offer this tutor&apos;s open times to families
                rescheduling a session themselves (their local time). Leave empty to default to their
                existing session hours ±2 hours. Families only ever see the 2–3 offered times, never
                the calendar.
              </label>
              <div className="space-y-1.5">
                {windows.map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={w.weekday}
                      onChange={(e) =>
                        setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))
                      }
                      className="border border-gray-300 rounded p-1.5 text-sm"
                    >
                      {WEEKDAYS.map((d, di) => (
                        <option key={d} value={di + 1}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      step={300}
                      value={w.start_time}
                      onChange={(e) =>
                        setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))
                      }
                      className="border border-gray-300 rounded p-1.5 text-sm"
                    />
                    <span className="text-gray-400 text-sm">to</span>
                    <input
                      type="time"
                      step={300}
                      value={w.end_time}
                      onChange={(e) =>
                        setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))
                      }
                      className="border border-gray-300 rounded p-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}
                      className="text-xs text-gray-500 underline"
                    >
                      remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setWindows((ws) => [...ws, { weekday: 1, start_time: '15:00', end_time: '19:00' }])
                  }
                  className="text-xs text-hgl-blue underline"
                >
                  + add window
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Default Zoom link (one field everywhere — prefills online schedules and online classes)
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="https://meet.google.com/… or the SLC office"
                className="w-full border border-gray-300 rounded-md p-2"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                QBO pay-type titles — the named additional pay types this tutor has in QBO Payroll
                (e.g. Class/Workshop, chem prep). Titles only: rates and dollar amounts live in QBO
                and never enter the portal. Base pay (1-on-1 / Test Prep) is implicit — don&apos;t list it.
              </label>
              <div className="flex flex-wrap gap-1.5 items-center">
                {payTitles.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 bg-gray-100 border border-gray-300 rounded px-2 py-0.5 text-xs"
                  >
                    {t}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setPayTitles((p) => p.filter((x) => x !== t))}
                        className="text-gray-400 hover:text-red-600"
                        title="Remove this title"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {payTitles.length === 0 && !isAdmin && (
                  <span className="text-xs text-gray-400 italic">none listed</span>
                )}
                {isAdmin ? (
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const t = newTitle.trim()
                        if (t && !payTitles.includes(t)) setPayTitles((p) => [...p, t])
                        setNewTitle('')
                      }
                    }}
                    placeholder="Add a title, press Enter"
                    className="border border-gray-300 rounded p-1.5 text-xs w-44"
                  />
                ) : (
                  <span className="text-xs text-gray-400">— edited by the admin only</span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Pay type — salaried tutors&apos; sessions and timecards are tracked exactly the same,
                but their timecards are labeled &ldquo;not paid hourly&rdquo; and the payroll export
                separates them. Salary amounts never enter the portal.
              </label>
              {isAdmin ? (
                <div className="flex gap-2">
                  {(['hourly', 'salaried'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPayType(v)}
                      className={`px-3 py-1.5 rounded border text-xs font-semibold ${
                        payType === v
                          ? 'bg-hgl-slate text-white border-hgl-slate'
                          : 'bg-white text-gray-600 border-gray-300'
                      }`}
                    >
                      {v === 'hourly' ? 'Paid hourly' : 'Salaried — hours tracked for records'}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  {payType === 'salaried'
                    ? 'Salaried — hours tracked for records; not paid hourly'
                    : 'Paid hourly'}{' '}
                  <span className="text-gray-400">— changed by the admin only</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-600 font-semibold mb-1">
                Matching notes (staff-only — personality, style, who they click with; tutors never see this)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-md p-2"
              />
            </div>

            {error && <div className="p-2 rounded bg-red-100 text-red-700 text-sm font-semibold">{error}</div>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => onClose(false)}
                className="py-2 px-4 rounded border border-gray-300 text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="bg-hgl-slate text-white py-2 px-4 rounded hover:opacity-90 disabled:opacity-60"
              >
                {emailChanged ? 'Save — email changes their login' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
