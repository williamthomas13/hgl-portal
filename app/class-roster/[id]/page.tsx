import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { checkCounselorRosterToken, classroomRequestUrlFor } from '../../utils/lifecycle'
import { bySessionStart } from '../../utils/dates'
import { one, type ScoreRow } from '../../portal/shared'
import CounselorClassCard from '../../portal/counselor-class-card'
import RequestForm from '../../classroom-request/[id]/request-form'
import { PublicNoticeCard } from '../../components/PublicNotice'

// PL-131: the counselor's no-login roster page — the middle step that was
// missing. Counselors already had tokenized room entry and a login portal;
// a counselor reading a CD digest who wants to see the roster right now
// shouldn't have to go find their login.
//
// Renders the SAME card the logged-in counselor-view renders, so the two
// surfaces can never drift apart.
//
// SCOPING — the important part. This page runs as admin (a tokenized page
// has no session, so RLS can't scope it). The token proves who asked, and
// the query below re-enforces, in SQL, exactly what the RLS policies encode:
// this counselor's own school, and only this class. A token for one class
// can never be pointed at another, and a valid token whose counselor has
// since left the school stops working, because the affiliation check is
// live rather than baked into the link.
//
// Privacy: tokenized pages are bearer links. Nothing here goes beyond what
// counselor-view already shows that school's counselor — no parent contact
// details, no payment amounts, no registration notes.

export const dynamic = 'force-dynamic'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function ClassRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const token = first(sp.t) ?? ''
  const counselorEmail = (first(sp.ce) ?? '').trim()

  const state = counselorEmail ? checkCounselorRosterToken(id, counselorEmail, token) : 'invalid'
  if (state === 'expired') {
    return (
      <PublicNoticeCard title="This link has aged out">
        Roster links retire themselves after a few months so an old email can&apos;t be used
        later by someone it was forwarded to. The link in your most recent class update will
        work — or reply to any of our emails and we&apos;ll send a fresh one.
      </PublicNoticeCard>
    )
  }
  if (state === 'invalid') {
    return (
      <PublicNoticeCard title="We couldn't open that link">
        It may be incomplete — email apps sometimes trim long links. Try the button in the
        original email again, or reply and we&apos;ll help.
      </PublicNoticeCard>
    )
  }

  // The counselor's ACTIVE affiliations (PL-122: active = ended_at IS NULL).
  // PL-158: exact match on the normalized email — ilike treated % and _ in
  // the token-carried address as wildcards, quietly widening schoolIds.
  // Contacts emails are lowercased at write (counselors panel), so
  // lowercasing the operand keeps the case-insensitivity ilike provided.
  const { data: affiliations } = await supabase
    .from('school_affiliations')
    .select('school_id, contacts!inner ( email ), schools ( name, nickname )')
    .is('ended_at', null)
    .eq('contacts.email', counselorEmail.toLowerCase())
  const schoolIds = (affiliations ?? []).map((a: { school_id: string }) => a.school_id)
  if (schoolIds.length === 0) {
    return (
      <PublicNoticeCard title="We couldn't find your school">
        This link is tied to a school contact record we can no longer match. Reply to any of our
        emails and we&apos;ll sort it out.
      </PublicNoticeCard>
    )
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // THE scoping query: this class, AND only if it belongs to one of this
  // counselor's own schools. A wrong-school token finds nothing here.
  const { data: rows } = await supabase
    .from('classes')
    .select(
      `
      id, slug, status, class_type, delivery_mode, price, capacity,
      start_date, registration_close_date, enrollment_deadline,
      default_location, school_id, collateral_language, timezone, display_cities,
      schools ( name, nickname, collateral_language, timezone, city ),
      instructors ( name, email ),
      sessions ( id, session_date, start_time, end_time, location ),
      enrollments (
        id, payment_status, enrolled_at, accommodations, waitlist_offer_expires_at,
        attendance_records ( session_id, enrollment_id, present, arrived_late, left_early, minutes_late, minutes_left_early ),
        students ( id, first_name, last_name, grade_level, graduating_year )
      )
    `
    )
    .eq('id', id)
    .in('school_id', schoolIds)
    .limit(1)

  const cls = (rows as any[])?.[0]
  if (!cls) {
    return (
      <PublicNoticeCard title="That class isn't on your roster">
        This link doesn&apos;t match a class at your school. If you think it should, reply to any
        of our emails and we&apos;ll take a look.
      </PublicNoticeCard>
    )
  }

  const studentIds = [
    ...new Set(
      ((cls.enrollments ?? []) as any[]).map((e) => one<any>(e.students)?.id).filter(Boolean)
    ),
  ]
  const { data: scores } = studentIds.length
    ? await supabase
        .from('student_scores')
        .select('id, student_id, class_id, test_label, section_scores, total, taken_at')
        .in('student_id', studentIds)
    : { data: [] as ScoreRow[] }

  const sessions = [...(cls.sessions ?? [])].sort(bySessionStart)
  const firstSession = sessions[0]?.session_date ?? cls.start_date
  const registrationClose = cls.registration_close_date ?? firstSession
  const today = new Date().toLocaleDateString('en-CA')
  const enrollments = (cls.enrollments ?? []) as any[]
  const decorated = {
    ...cls,
    sessions,
    firstSession,
    registrationClose,
    paid: enrollments.filter((e) => ['Paid', 'Completed'].includes(e.payment_status)).length,
    waitlist: enrollments.filter((e) => e.payment_status === 'Waitlisted').length,
  }
  const stillOpen = cls.status !== 'cancelled' && today <= registrationClose
  const schoolName = one<any>(cls.schools)?.name ?? 'your school'
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-hgl-slate">Live roster</h1>
          <p className="text-sm text-gray-500">
            {schoolName} — updated the moment anything changes. No login needed; this link is
            just for you.
          </p>
        </div>

        {/* PL-131 chase synergy: where the class still has no room, the same
            "tell us the room" field appears inline. One page, both jobs — the
            counselor who came to look at the roster can answer the open
            question without a second email. */}
        {!cls.default_location && cls.delivery_mode !== 'online' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
            <h2 className="font-bold text-hgl-slate mb-1">We still need a room for this class</h2>
            <p className="text-sm text-gray-700 mb-3">
              Families are told the location a few days before the first session, so this is the
              one detail we can&apos;t fill in ourselves.
            </p>
            <RequestForm
              classId={cls.id}
              token={
                new URL(classroomRequestUrlFor(cls.id, counselorEmail)).searchParams.get('t') ?? ''
              }
              counselorEmail={counselorEmail}
            />
          </div>
        )}

        <CounselorClassCard
          c={decorated}
          withRegLink={stillOpen}
          allScores={(scores ?? []) as ScoreRow[]}
          base={base}
        />

        <p className="text-xs text-gray-500 text-center">
          Want every class at {schoolName} in one place, with attendance and scores?{' '}
          <a href={`${base}/portal`} className="text-hgl-blue underline">
            Sign in to the counselor portal
          </a>
          .
        </p>
      </div>
    </div>
  )
}
