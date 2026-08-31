import { supabaseAdmin as supabase } from '../utils/supabase-admin'
import { escapeLike } from '../utils/like-escape'
import { renderSiteMarkdown } from '../utils/site-md'
import { addonPageUrlFor, loadTutoringPackages, packageSavings } from '../utils/lifecycle'
import { classTutoringTier } from '../utils/tutoring-tier'
import { DISCOUNT_URL } from '../utils/email'
import { formatDateOnly } from '../utils/dates'

// PL-423: the Tutoring pane for CLASS-ONLY families — a gentle pitch built
// from the SAME sells already in the system (the one-on-one-pitch flow block
// the registration page renders — ONE copy source, PL-96 drift rule) plus
// the family's REAL purchase path per class phase, matching the pricing
// framing the price list and the PL-207 card already use:
//   · before the class: the tokenized add-on page + pre-class package rates
//     ("only until the class starts" — the addon page's own framing)
//   · while it runs: the honest existing line (the price list has NO
//     during-class purchase row and the addon page closes at session 1 —
//     no invented price, no invented urgency)
//   · after: post-class package savings + the discount page (email #8's path)
// Gate: a paid class enrollment AND zero tutoring anywhere (no active/paused
// engagement, no invoice — those families get the real pane — and no
// purchased add-on hours — those families already said yes; their card works
// the redemption). One pitch, quiet styling, no badges.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export default async function TutoringPitchSection({ email }: { email: string }) {
  const { data: familyRows } = await supabase
    .from('families')
    .select('id')
    .ilike('parent_email', escapeLike(email))
  const familyIds = (familyRows ?? []).map((f) => f.id)
  if (familyIds.length === 0) return null

  const [{ count: engCount }, { count: invCount }, { data: students }] = await Promise.all([
    supabase
      .from('tutoring_engagements')
      .select('id, students!inner ( family_id )', { count: 'exact', head: true })
      .in('students.family_id', familyIds)
      .in('status', ['active', 'paused']),
    supabase
      .from('tutoring_invoices')
      .select('id', { count: 'exact', head: true })
      .in('family_id', familyIds),
    supabase
      .from('students')
      .select(
        `id, first_name, family_id,
         enrollments (
           id, payment_status,
           enrollment_addons ( hours ),
           classes ( id, class_type, status, delivery_mode, school_id, start_date,
             sessions ( session_date ), schools ( nickname ) )
         )`
      )
      .in('family_id', familyIds),
  ])
  // Families with tutoring in any form see the real pane / their card.
  if ((engCount ?? 0) > 0 || (invCount ?? 0) > 0) return null
  const anyAddonHours = ((students as any[]) ?? []).some((st) =>
    (st.enrollments ?? []).some(
      (e: any) =>
        ['Paid', 'Completed'].includes(e.payment_status) &&
        (e.enrollment_addons ?? []).some((a: any) => Number(a.hours) > 0)
    )
  )
  if (anyAddonHours) return null

  const todayIso = new Date().toLocaleDateString('en-CA')
  const phaseOf = (cls: any): 'prestart' | 'running' | 'finished' => {
    const dates = (cls.sessions ?? []).map((s: any) => s.session_date).sort()
    const first = dates[0] ?? cls.start_date
    const last = dates[dates.length - 1] ?? cls.start_date
    return todayIso < first ? 'prestart' : todayIso > last ? 'finished' : 'running'
  }

  type Target = { studentFirst: string; enrollment: any; cls: any; phase: 'prestart' | 'running' | 'finished' }
  const targets: Target[] = []
  for (const st of (students as any[]) ?? []) {
    const paid = (st.enrollments ?? []).filter(
      (e: any) =>
        ['Paid', 'Completed'].includes(e.payment_status) &&
        one<any>(e.classes) &&
        one<any>(e.classes).status !== 'cancelled'
    )
    if (paid.length === 0) continue
    const pick =
      paid.find((e: any) => phaseOf(one<any>(e.classes)) === 'prestart') ??
      paid.find((e: any) => phaseOf(one<any>(e.classes)) === 'running') ??
      paid[paid.length - 1]
    const cls = one<any>(pick.classes)
    targets.push({ studentFirst: st.first_name, enrollment: pick, cls, phase: phaseOf(cls) })
  }
  if (targets.length === 0) return null

  // ONE copy source with the registration flow (PL-357 block).
  let pitchMarkdown: string | null = null
  try {
    const { data: pitch } = await supabase
      .from('site_content_blocks')
      .select('body_markdown')
      .eq('key', 'one-on-one-pitch')
      .maybeSingle()
    pitchMarkdown = pitch?.body_markdown ?? null
  } catch {
    pitchMarkdown = null
  }

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-6 mt-8">
      <h2 className="text-lg font-bold text-hgl-slate mb-2">1-on-1 tutoring</h2>
      {pitchMarkdown && (
        <div
          className="text-sm text-gray-700 space-y-2 mb-4 [&_a]:text-hgl-blue [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: renderSiteMarkdown(pitchMarkdown) }}
        />
      )}
      <div className="space-y-3">
        {await Promise.all(
          targets.map(async (t) => {
            const label = `${one<any>(t.cls.schools)?.nickname ?? 'HGL'} ${t.cls.class_type}`
            const tier = classTutoringTier({ school_id: t.cls.school_id, delivery_mode: t.cls.delivery_mode })
            const { pre, post } = await loadTutoringPackages(tier)
            const dates = (t.cls.sessions ?? []).map((s: any) => s.session_date).sort()
            const firstSession = dates[0] ?? t.cls.start_date
            if (t.phase === 'prestart' && pre.length > 0) {
              const best = pre.reduce((a: any, b: any) => (Number(a.hourlyRate) <= Number(b.hourlyRate) ? a : b))
              return (
                <div key={t.enrollment.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <p className="text-gray-700">
                    <span className="font-semibold text-hgl-slate">{t.studentFirst} · {label}:</span>{' '}
                    1-on-1 hours are from <strong>${best.hourlyRate}/hr</strong> with a package
                    (regular ${best.regularHourlyRate}/hr) — these rates are only available before
                    the class starts, {formatDateOnly(firstSession, { month: 'long', day: 'numeric' })}.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {pre.map((p: any) => (
                      <a
                        key={p.id}
                        href={addonPageUrlFor(t.enrollment.id)}
                        className="inline-block bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-hgl-blue-hover"
                      >
                        {p.hours} hours — save ${packageSavings(p)}
                      </a>
                    ))}
                  </div>
                </div>
              )
            }
            if (t.phase === 'running') {
              return (
                <div key={t.enrollment.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <p className="text-gray-700">
                    <span className="font-semibold text-hgl-slate">{t.studentFirst} · {label}:</span>{' '}
                    students taking the class are eligible for discounted 1-on-1 hours after it ends
                    — look out for an email when it finishes, or get in touch now if you&apos;d like
                    to start sooner.
                  </p>
                </div>
              )
            }
            return (
              <div key={t.enrollment.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                <p className="text-gray-700">
                  <span className="font-semibold text-hgl-slate">{t.studentFirst} · {label}:</span>{' '}
                  students who complete one of our classes get discounted 1-on-1 hours to keep the
                  momentum going{post.length > 0 ? (
                    <> — {post.map((p: any) => `${p.hours} hours save $${packageSavings(p)}`).join(' · ')}</>
                  ) : null}.
                </p>
                <a
                  href={DISCOUNT_URL}
                  className="inline-block mt-2 bg-hgl-blue text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-hgl-blue-hover"
                >
                  Get discounted tutoring hours
                </a>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
