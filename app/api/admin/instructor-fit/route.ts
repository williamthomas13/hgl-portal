import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'
import {
  isPortalSyncedClassTitle,
  isPortalSyncedTutoringTitle,
  listBusyEvents,
  loadGcalConnection,
  type TitledBusyBlock,
} from '../../../utils/gcal'
import { holdActive } from '../../../utils/gcal-sync'
import { isOnlineLocation } from '../../../utils/calendar-colors'
import { zonedToUtc } from '../../../utils/tutoring'

// PL-161: the instructor-fit suggester — ADVISORY ONLY. Given a class's
// stated session times, each ACTIVE candidate instructor is checked against
// (a) their Google busy data (the same machinery that shades the tutor-week
// grid), (b) portal commitments including PL-159 holds, and (c) in-person
// travel spans for the class window. Ranked with the conflicts named
// plainly; an instructor with a hard session-time conflict is NEVER ranked
// available. Assignment stays a human click on the class page — this
// endpoint only informs, and the calendar overlay shows exactly what the
// ranking saw so Kelsie can disagree with it.

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  v == null ? null : Array.isArray(v) ? ((v[0] as T) ?? null) : v

type Interval = { start: number; end: number; label: string }
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && a.end > b.start

const fmt = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export async function GET(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const classId = new URL(req.url).searchParams.get('classId')
  if (!classId) return NextResponse.json({ error: 'Pass classId.' }, { status: 400 })

  const { data: cls } = await supabase
    .from('classes')
    .select(
      `id, class_type, delivery_mode, instructor_id,
       schools ( name, nickname, timezone ),
       sessions ( session_date, start_time, end_time )`
    )
    .eq('id', classId)
    .maybeSingle()
  if (!cls) return NextResponse.json({ error: 'Unknown class.' }, { status: 404 })
  const school = one<any>((cls as any).schools)
  const tz = school?.timezone ?? 'America/Denver'
  const sessions: Interval[] = (((cls as any).sessions as any[]) ?? [])
    .map((s) => ({
      start: zonedToUtc(s.session_date, String(s.start_time).slice(0, 5), tz).getTime(),
      end: zonedToUtc(s.session_date, String(s.end_time).slice(0, 5), tz).getTime(),
      label: `${s.session_date} ${String(s.start_time).slice(0, 5)}`,
    }))
    .filter((s) => s.end > Date.now())
    .sort((a, b) => a.start - b.start)
  if (sessions.length === 0) {
    return NextResponse.json({ classLabel: `${school?.nickname ?? ''} ${(cls as any).class_type}`, candidates: [], note: 'No future sessions on this class yet — add the schedule first.' })
  }
  const spanStart = sessions[0].start
  const spanEnd = sessions.at(-1)!.end
  const inPerson = (cls as any).delivery_mode !== 'online'

  // PL-176: inactive instructors are excluded from the suggester.
  const { data: instructors } = await supabase
    .from('instructors')
    .select('id, name, email, google_calendar_id, timezone, active')
    .eq('active', true)
    .order('name')

  const conn = await loadGcalConnection()
  const googleUp = Boolean(conn?.key && conn.status === 'connected')

  // Portal commitments for ALL candidates in the window, in two queries.
  const [{ data: tutoring }, { data: classSessions }] = await Promise.all([
    supabase
      .from('tutoring_sessions')
      .select(
        `tutor_id, starts_at, ends_at, status,
         students ( first_name ),
         tutoring_engagements ( location, status, approval_requested_at )`
      )
      .in('status', ['proposed', 'confirmed'])
      .lt('starts_at', new Date(spanEnd).toISOString())
      .gt('ends_at', new Date(spanStart).toISOString()),
    supabase
      .from('sessions')
      .select(
        `session_date, start_time, end_time,
         classes!inner ( id, class_type, status, delivery_mode, instructor_id, schools ( nickname, timezone ) )`
      )
      .gte('session_date', new Date(spanStart - 86_400_000).toISOString().slice(0, 10))
      .lte('session_date', new Date(spanEnd).toISOString().slice(0, 10)),
  ])

  const portalByTutor = new Map<string, { iv: Interval; inPerson: boolean }[]>()
  for (const s of (tutoring as any[]) ?? []) {
    const eng = one<any>(s.tutoring_engagements)
    if (s.status === 'proposed' && !holdActive(eng?.status ?? 'active', eng?.approval_requested_at ?? null)) continue
    const stu = one<any>(s.students)
    const entry = {
      iv: {
        start: new Date(s.starts_at).getTime(),
        end: new Date(s.ends_at).getTime(),
        label: `${s.status === 'proposed' ? 'proposed hold' : 'tutoring'} — ${stu?.first_name ?? 'a student'}`,
      },
      inPerson: !isOnlineLocation(eng?.location ?? null),
    }
    portalByTutor.set(s.tutor_id, [...(portalByTutor.get(s.tutor_id) ?? []), entry])
  }
  for (const s of (classSessions as any[]) ?? []) {
    const c = one<any>(s.classes)
    if (!c?.instructor_id || c.id === classId || c.status === 'cancelled') continue
    const ctz = one<any>(c.schools)?.timezone ?? 'America/Denver'
    const entry = {
      iv: {
        start: zonedToUtc(s.session_date, String(s.start_time).slice(0, 5), ctz).getTime(),
        end: zonedToUtc(s.session_date, String(s.end_time).slice(0, 5), ctz).getTime(),
        label: `class — ${one<any>(c.schools)?.nickname ?? ''} ${c.class_type}`.trim(),
      },
      inPerson: c.delivery_mode !== 'online',
    }
    portalByTutor.set(c.instructor_id, [...(portalByTutor.get(c.instructor_id) ?? []), entry])
  }

  const candidates = []
  for (const inst of (instructors as any[]) ?? []) {
    const hard: string[] = []
    const travel: string[] = []
    const portal = portalByTutor.get(inst.id) ?? []
    for (const p of portal) {
      if (sessions.some((s) => overlaps(s, p.iv))) {
        hard.push(`${p.iv.label} at ${fmt(p.iv.start)} (portal)`)
      } else if (inPerson && p.inPerson && p.iv.start < spanEnd && p.iv.end > spanStart) {
        travel.push(`${p.iv.label} at ${fmt(p.iv.start)} — inside the travel window`)
      }
    }
    // PL-433: TITLED busy (the PL-388 pattern — the one surface it missed).
    // The portal's own synced events (tutoring + class sessions) are counted
    // precisely by the portal-side checks above; their Google echoes were
    // the double-count (Scarlett's 8-conflicts screenshot = 4 real). Only
    // genuine external Google busy survives, NAMED when the calendar shares
    // the title with our connection, generic when private. On a titles-read
    // failure the ranking stays honestly portal-only (googleChecked=false —
    // the existing flag) rather than falling back to unfilterable raw
    // freebusy and resurrecting the double-count.
    let googleChecked = false
    if (googleUp) {
      try {
        const busy: TitledBusyBlock[] = []
        for (let t = spanStart; t < spanEnd; t += 42 * 86_400_000) {
          busy.push(
            ...(await listBusyEvents(
              conn!.key!,
              inst.email,
              inst.google_calendar_id,
              new Date(t).toISOString(),
              new Date(Math.min(t + 42 * 86_400_000, spanEnd)).toISOString(),
              inst.timezone ?? 'America/Denver'
            ))
          )
        }
        googleChecked = true
        for (const b of busy) {
          if (isPortalSyncedTutoringTitle(b.title) || isPortalSyncedClassTitle(b.title)) continue
          const iv = { start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }
          const clash = sessions.find((s) => overlaps(s, iv))
          if (clash) {
            hard.push(
              b.title && !b.private
                ? `busy per Google Calendar: "${b.title}" at ${fmt(iv.start)}`
                : `busy per Google Calendar at ${fmt(iv.start)}`
            )
          }
        }
      } catch {
        googleChecked = false
      }
    }
    candidates.push({
      id: inst.id,
      name: inst.name ?? inst.email,
      current: inst.id === (cls as any).instructor_id,
      available: hard.length === 0,
      googleChecked,
      hardConflicts: [...new Set(hard)].slice(0, 8),
      travelConflicts: [...new Set(travel)].slice(0, 8),
    })
  }
  candidates.sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      a.hardConflicts.length - b.hardConflicts.length ||
      a.travelConflicts.length - b.travelConflicts.length ||
      a.name.localeCompare(b.name)
  )

  return NextResponse.json({
    classLabel: `${school?.nickname ?? school?.name ?? ''} ${(cls as any).class_type}`.trim(),
    classId,
    inPerson,
    sessionCount: sessions.length,
    spanStart: new Date(spanStart).toISOString(),
    spanEnd: new Date(spanEnd).toISOString(),
    googleUp,
    candidates,
  })
}
