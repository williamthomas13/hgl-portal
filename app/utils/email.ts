import { Resend } from 'resend'
import { nonProductionOrigins } from './base-url'
import { classLocationTailText } from './comms-variables'
import { supabaseAdmin as supabase } from "./supabase-admin"
import { convertUrlFor, refundRequestUrlFor, packageSavings, type AddonRow, type TutoringPackage } from './lifecycle'
import { templateMetaFor, type RecipientRole } from './comms'
import { formatDateFull } from './dates'

// Server-side only. Every send goes through sendOnce(), which claims a row in
// email_log first — Stripe webhook retries and cron re-runs never double-send.
//
// COPY: final copy from docs/EMAIL_COPY.md (v1.0). Template variables map to
// EnrollmentEmailContext fields; pronoun-conditional templates take an
// `audience` argument and render third person for the parent send, second
// person for the student send. Footer types per the deck: T = transactional
// (no unsubscribe), R = relationship (marketing opt-out link).

export const FROM = process.env.EMAIL_FROM ?? 'Higher Ground Learning <onboarding@resend.dev>'

// Personal sender for #1, #7, #8, #9 (and the combined welcome, which
// carries #1). Deck: "William Thomas <billy@highergroundlearning.com>".
export const PERSONAL_FROM =
  process.env.EMAIL_FROM_PERSONAL ?? 'William Thomas <billy@highergroundlearning.com>'

const FAQ_LINKS = `<a href="https://highergroundlearning.com/faqs#general">General</a> · <a href="https://highergroundlearning.com/faqs#diagnostic-tests">Diagnostic tests</a> · <a href="https://highergroundlearning.com/faqs#attendance">Attendance</a> · <a href="https://highergroundlearning.com/faqs#1on1">1-on-1 tutoring</a>`

const COMPASS_URL = 'http://hgl.co/college-prep-compass'
const REVIEW_URL = 'https://g.page/highergroundlearning/review?gm'
const DISCOUNT_URL = 'https://highergroundprep.com/discount'

export type Audience = 'parent' | 'student'

export type SessionInfo = {
  id: string
  session_date: string
  start_time: string | null
  end_time: string | null
  location: string | null
}

export type EnrollmentEmailContext = {
  enrollmentId: string
  classId: string
  /** PL-118: the class/school IANA timezone — every deadline a family reads
   *  must render in THEIR class's zone, matching the enforced instant. */
  timezone: string
  calendarPageUrl: string
  resumePaymentUrl: string
  /** /portal deep link with signed login prefill (#0 button, PHASE4_SPEC §9). */
  portalUrl: string
  /** Always first session date − 1 day. Computed, never stored. */
  diagnosticDueDate: string
  /** Tutoring add-ons purchased with this enrollment. */
  addons: AddonRow[]
  marketingOptOut: boolean
  unsubscribeUrl: string
  /** PL-53b: the family's signed share-your-availability page. */
  availabilityUrl: string
  parentFirstName: string
  parentEmail: string
  studentFirstName: string
  studentLastName: string
  studentEmail: string | null
  /** PL-69: she_her | he_him | they_them | null (unset → they/them). */
  studentPronouns: string | null
  graduatingYear: string | null
  accommodations: string | null
  previousScores: string | null
  notes: string | null
  amountPaid: number | null
  paidAt: string | null
  enrolledAt: string
  schoolName: string
  schoolNickname: string
  classType: string
  /** "{schoolNickname} {classType}", e.g. "SLS SAT Prep". */
  className: string
  /** Uniform session time range, or null → copy says "see the class calendar". */
  classTime: string | null
  examInfo: { examName: string; regLabel: string; regUrl: string } | null
  instructorName: string | null
  defaultLocation: string | null
  deliveryMode: string
  synapGroup: string | null
  startDate: string
  firstSession: string
  lastSession: string
  price: number
  sessions: SessionInfo[]
}

// ---------------------------------------------------------------------------
// Shared rendering helpers
// ---------------------------------------------------------------------------

export function formatDate(iso: string) {
  return formatDateFull(iso)
}

function formatTime(t: string | null) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

export function sessionLine(s: SessionInfo, fallbackLocation: string | null) {
  const parts = [formatDate(s.session_date)]
  const start = formatTime(s.start_time)
  const end = formatTime(s.end_time)
  if (start) parts.push(end ? `${start}–${end}` : start)
  const loc = s.location ?? fallbackLocation
  if (loc) parts.push(loc)
  return parts.join(' · ')
}

/** {classTime}, or a calendar-page fallback per the spec's computed rule. */
function classTimeHtml(ctx: EnrollmentEmailContext) {
  return ctx.classTime ?? `the times shown on <a href="${ctx.calendarPageUrl}">the class calendar</a>`
}

/** {classroom}: online classes render the meeting link as a link. */
function classroomHtml(ctx: EnrollmentEmailContext) {
  const loc = ctx.defaultLocation
  if (!loc) return 'TBD'
  return /^https?:\/\//i.test(loc) ? `<a href="${loc}">${loc}</a>` : loc
}

/** {synapGroupLink}: the synap_group field holds the group URL. */
function synapUrl(ctx: EnrollmentEmailContext) {
  const v = ctx.synapGroup
  if (!v) return null
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

function recipientFirstName(ctx: EnrollmentEmailContext, audience: Audience) {
  return audience === 'student' ? ctx.studentFirstName : ctx.parentFirstName
}

function button(label: string, href: string) {
  return `
    <p style="margin:20px 0">
      <a href="${href}" style="display:inline-block;background:#00AEEE;color:#fff;
      font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">${label}</a>
    </p>`
}

export function calendarButton(ctx: EnrollmentEmailContext) {
  return button('Download the course calendar', ctx.calendarPageUrl)
}

// Footer types per the deck. T = transactional: address block + footer text,
// no unsubscribe. R = relationship: address block + opt-out link.
//
// PL-64: the postal address rides every footer (CAN-SPAM requires it for the
// promotional sends — #8, #9, NW, WR — and it's a deliverability/trust
// signal for the rest; uniform for consistency). It lives in app_settings
// (business_address) so an office move is a settings edit, cached here with
// the seeded value as the synchronous fallback — footers render sync, so the
// cache refreshes behind the first render of a fresh lambda and every render
// after that reads the stored value. "USA" included on purpose: many
// recipients are international school families.
const DEFAULT_BUSINESS_ADDRESS = '380 W. Pierpont Ave, Salt Lake City, UT 84101, USA'
const addressCache = { value: DEFAULT_BUSINESS_ADDRESS, at: 0 }
function businessAddress(): string {
  if (Date.now() - addressCache.at > 60_000) {
    addressCache.at = Date.now() // stampede guard: one refresh per minute
    void supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'business_address')
      .maybeSingle()
      .then(({ data }) => {
        if (typeof data?.value === 'string' && data.value.trim()) addressCache.value = data.value.trim()
      })
  }
  return addressCache.value
}

export function footerT(customText?: string) {
  return `${customText ? `<p style="font-size:13px;color:#64748b">${customText}</p>` : ''}
    <p style="font-size:13px;color:#64748b">Higher Ground Learning · ${businessAddress()} ·
    highergroundlearning.com · questions? Just reply to this email.</p>`
}

export function footerR(unsubscribeUrl: string, customText?: string) {
  return `${customText ? `<p style="font-size:13px;color:#64748b">${customText}</p>` : ''}
    <p style="font-size:13px;color:#64748b">Higher Ground Learning · ${businessAddress()} ·
    highergroundlearning.com ·
    <a href="${unsubscribeUrl}" style="color:#64748b">Unsubscribe from non-essential updates</a></p>`
}

export type WrapOpts = {
  /** Hidden preview-text line shown next to the subject in inbox lists. */
  preheader: string
  footer: string
}

export function wrap(body: string, opts: WrapOpts) {
  // Hidden preheader + whitespace padding so clients don't pull body text
  // into the preview line instead. Same technique React Email's <Preview>
  // renders to.
  const preheader = `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;mso-hide:all">
        ${opts.preheader}${'&#8199;&#65279; '.repeat(30)}
      </div>`
  return `
  ${preheader}
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;line-height:1.55">
    <div style="border-top:4px solid #00AEEE;padding:24px 8px">
      ${body}
      <div style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:12px">
        ${opts.footer}
      </div>
    </div>
  </div>`
}

export type Rendered = { subject: string; html: string; from?: string }

// PL-69: the one student-pronoun source. Unset resolves to exactly the
// they/them copy every email used before pronouns existed — nothing ever
// blocks on the field. Verb agreement rides along (she has / they have).
// PL-80: 'name_only' substitutes the student's name wherever a pronoun
// would go ("Ana has", "Ana's") — never a wrong pronoun, never new copy.
export function studentPronounSet(
  ctx: Pick<EnrollmentEmailContext, 'studentPronouns' | 'studentFirstName'>
): {
  subj: string
  obj: string
  poss: string
  have: string
  need: string
  dont: string
} {
  switch (ctx.studentPronouns) {
    case 'she_her':
      return { subj: 'she', obj: 'her', poss: 'her', have: 'has', need: 'needs', dont: "doesn't" }
    case 'he_him':
      return { subj: 'he', obj: 'him', poss: 'his', have: 'has', need: 'needs', dont: "doesn't" }
    case 'name_only':
      return {
        subj: ctx.studentFirstName,
        obj: ctx.studentFirstName,
        poss: `${ctx.studentFirstName}'s`,
        have: 'has',
        need: 'needs',
        dont: "doesn't",
      }
    default:
      return { subj: 'they', obj: 'them', poss: 'their', have: 'have', need: 'need', dont: "don't" }
  }
}

// ---------------------------------------------------------------------------
// #0-P — Registration Confirmation (parent) · instant · info@ · T
// ---------------------------------------------------------------------------

/** PL-53a (approved copy, July 20): the #0 tutoring paragraph renders ONLY
 *  when the enrollment actually has an add-on — never for class-only. It
 *  de-urgents deliberately (hours are most valuable after class) and links —
 *  inline, not a button — to the family's availability page for early
 *  starters. Shared by the code render and the registry's
 *  {addonTutoringBlock} variable so both stay one source of truth. */
export function addonTutoringBlockHtml(ctx: EnrollmentEmailContext): string {
  const hours = ctx.addons.reduce((sum, a) => sum + a.hours, 0)
  if (hours <= 0) return ''
  return `<p><strong>Your 1-on-1 tutoring hours.</strong> Your registration includes ${hours} hours
      of 1-on-1 tutoring. In our experience they're most valuable <em>after</em> the class ends —
      that's when a tutor can zero in on exactly what your student needs next. When the class
      wraps up, we'll reach out to get ${ctx.studentFirstName} scheduled. Want to start earlier
      instead? <a href="${ctx.availabilityUrl}" style="color:#00AEEE">Share your availability</a>
      and we'll propose times. Not sure yet? No problem — we'll ask again once the class is
      done.</p>`
}

export function parentConfirmationEmail(ctx: EnrollmentEmailContext): Rendered {
  const addonLines = ctx.addons
    .map((a) => `<br/>${a.name} — 1-on-1 Tutoring — $${a.pricePaid}`)
    .join('')
  const detail = (label: string, value: string | null) =>
    `<br/><strong>${label}:</strong> ${value && value.trim() ? value : '—'}`
  return {
    subject: `Enrollment Confirmed — ${ctx.className}`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>Thanks for registering! Your class registration with Higher Ground Learning is confirmed.</p>
      <p>We'll be in touch with you in the days before the first day of class with all the relevant
      information that you'll need! This includes diagnostic test information, instructor information,
      and ${classLocationPhrase(ctx)}.</p>
      ${addonTutoringBlockHtml(ctx)}
      <p>If you have any questions between now and then, you can respond to this email (but maybe
      check our <a href="https://highergroundlearning.com/faqs#general">FAQs</a> first).</p>
      <h3 style="color:#334155">Enrollment Summary</h3>
      <p>${ctx.className} — $${ctx.price}${addonLines}
      <br/><strong>Amount paid:</strong> ${ctx.amountPaid != null ? `$${ctx.amountPaid}` : `$${ctx.price}`}
      · ${ctx.paidAt ? formatDate(ctx.paidAt.slice(0, 10)) : ''}</p>
      <h3 style="color:#334155">Registration Details</h3>
      <p><strong>Student:</strong> ${ctx.studentFirstName} ${ctx.studentLastName}
      ${detail('Student email', ctx.studentEmail)}
      ${detail('School', ctx.schoolName)}
      ${detail('Graduating year', ctx.graduatingYear)}
      ${detail('Testing accommodations', ctx.accommodations)}
      ${detail('Previous test scores', ctx.previousScores)}
      ${detail('Notes', ctx.notes)}</p>
      ${button('View your registration', ctx.portalUrl)}
    `,
      {
        preheader: `${ctx.studentFirstName} is registered. Here's what happens next.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// #0-S — Registration Confirmation (student) · instant · info@ · T
// ---------------------------------------------------------------------------

const STUDENT_TESTIMONIALS = `
  <p style="font-size:14px;color:#475569">"I am extremely excited to tell you that I got my best EVER score (better than any practice test) and I improved by 180 points. I GOT A 1500!!!! I got 8 wrong in reading, 1 wrong in writing, and 3 wrong in math! I wanted to thank you for everything that you've done for me and all the help you have given me with this test. I would not have been able to do this without your help. I hope you keep teaching students just like you taught me, because you are probably one of the best teachers I have ever had."<br/>—Gonzalo Dominguez, Madrid Spain</p>
  <p style="font-size:14px;color:#475569">"This course helped me a lot to prepare for the SAT. The course as a whole focuses on giving tips and strategies for the SAT. Also, weekly practice tests are done to test your skills and make you a more personalized preparation and experience. In the end, I increased by 140 points on the real SAT! A very enriching experience. Recommend it 100%"<br/>—Lucia de la Hoz, Bogotá Colombia</p>
  <p style="font-size:14px;color:#475569">"Best decision I made for my children's college preparation!!! Their ACT scores went from 27 and 28 to 32 and 34!!!!"<br/>—Kirsten McNeal, Salt Lake City USA</p>`

export function studentConfirmationEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `${ctx.className} - you're in!`,
    html: wrap(
      `
      <p>Or is it "your in"? "Yore inn"?</p>
      <p>…If you don't know, don't worry. We'll teach you!</p>
      <p>If you do know, great! We'll teach you a lot of other things, too. 🙂</p>
      <p><strong>${ctx.studentFirstName}, this is just a quick note to let you know that you have
      been registered for the ${ctx.className} class starting on ${formatDate(ctx.firstSession)}.</strong></p>
      <p>In the days before the course starts, you'll receive the necessary course information,
      such as ${classLocationPhrase(ctx)} and information to access your initial diagnostic test.</p>
      <p>(By the way, that test is due ${formatDate(ctx.diagnosticDueDate)}!)</p>
      <p>Until then, you might be interested in signing up for our free
      <a href="${COMPASS_URL}">College Prep Compass</a>, which goes over:</p>
      <ul style="padding-left:20px">
        <li>Practice problems with quick tips to tackle them,</li>
        <li>How you can get the most out of the class,</li>
        <li>How to best take advantage of your free 30-minute strategy session,</li>
        <li>Common misconceptions and FAQs about the test,</li>
        <li>Which schools are test optional (and what's the difference between test optional and test blind),</li>
        <li>What to do about test anxiety,</li>
        <li>and more.</li>
      </ul>
      <p>Either way, we'll see you in class!</p>
      <p>P.S. Here's what other students have had to say about the class:</p>
      ${STUDENT_TESTIMONIALS}
    `,
      {
        preheader: `See you on ${formatDate(ctx.firstSession)}`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// PR1–4 — Payment reminders · parent · info@ · T
// ---------------------------------------------------------------------------

export function paymentReminderEmail(ctx: EnrollmentEmailContext, n: number): Rendered {
  const finalize = button('Finalize Registration', ctx.resumePaymentUrl)
  const subject =
    n === 4
      ? `Last reminder: ${ctx.studentFirstName}'s ${ctx.className} registration expires soon`
      : `${ctx.studentFirstName}'s registration for ${ctx.className} isn't confirmed yet`
  // Expiry = 7 days after registration (PAYMENT_EXPIRY_HOURS). PL-118: a
  // datetime in the class's zone with a label — the sweep enforces the exact
  // instant, so a bare weekday could read a day off for the family.
  const expiry = new Date(new Date(ctx.enrolledAt).getTime() + 168 * 3_600_000)
  const expiryDate = zonedDeadline(expiry, ctx.timezone)
  const preheader =
    n === 4
      ? `After ${expiryDate}, the spot returns to the pool.`
      : `Complete your payment to save ${studentPronounSet(ctx).poss} place in class`

  const bodies: Record<number, string> = {
    1: `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>We saw that you filled out the registration form for ${ctx.studentFirstName} for the
      ${ctx.className} class but didn't proceed to complete payment and confirm ${studentPronounSet(ctx).poss} registration.
      If that was on purpose, no worries – ${ctx.studentFirstName} is welcome to register any time
      until the upcoming registration deadline if you change your mind.</p>
      <p>If you <em>did</em> intend to register for the class, we'd like to kindly ask you to
      complete the registration by making the payment here:</p>
      ${finalize}
      <p>P.S. Do you have a question about the class? It's probably answered in our FAQs here:</p>
      <p>${FAQ_LINKS}</p>`,
    2: `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>Just circling back — ${ctx.studentFirstName}'s registration for the ${ctx.className}
      class is still waiting on payment to be confirmed.</p>
      <p>If you paused because you had a question, that's completely reasonable — most answers are
      in our FAQs below, and for anything else, you can simply reply to this email and a real human
      will get back to you.</p>
      <p>If you're ready to go, it takes about a minute:</p>
      ${finalize}
      <p>P.S. FAQs: ${FAQ_LINKS}</p>`,
    3: `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>Quick nudge: ${ctx.studentFirstName}'s spot in ${ctx.className} is still reserved but
      unconfirmed. One minute finishes it:</p>
      ${finalize}`,
    4: `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>This is our last reminder — ${ctx.studentFirstName}'s registration for the
      ${ctx.className} class will <strong>expire on ${expiryDate}</strong>, and the spot will go
      back into the pool.</p>
      <p>If you'd still like to register, there's time:</p>
      ${finalize}
      <p>And if plans changed, no action needed — the registration will simply expire on its own,
      and ${ctx.studentFirstName} is welcome back anytime while spots remain.</p>
      <p>Higher Ground Learning</p>`,
  }

  return { subject, html: wrap(bodies[n], { preheader, footer: footerT() }) }
}

// ---------------------------------------------------------------------------
// #1 — Parent Thank-You · ~3h after payment · William Thomas <billy@> · R
// ---------------------------------------------------------------------------

const PARENT_TESTIMONIALS = `
  <p style="font-size:14px;color:#475569">"My wife and I would like to thank you for the excellent support that Higher Ground Learning gave to our son in his preparation for the SAT test. From a 1260 at the first practice test, he reached 1400 at the official test. This should be more than enough to enter his first choice university." —Walter Michelini, Italy</p>
  <p style="font-size:14px;color:#475569">"After his sessions, he wrote the SAT twice more, improving dramatically each time and his second score was a 1590. He loved the sessions as they worked on so much more than just the actual content – talking and learning about confidence in exam technique and about manifesting a good outcome. This had a wonderful impact on his approach to exams in general. I would recommend Higher Ground without reservation. Thanks again for a superb experience!!" —Elise Malherbe, South Africa</p>
  <p style="font-size:14px;color:#475569">"We initially worked with HGL to help my son with his SAT test prep. Beyond just teaching my son how to improve, Eric was a great mentor who legitimately cared about my son's interests and activities. Through this bond, Eric was able to push my son to invest in test prep and ultimately achieve a score good enough for any elite university." —Parent of Stanford '25 & '26, USA</p>`

function thankYouBody(ctx: EnrollmentEmailContext) {
  const s = ctx.studentFirstName
  return `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>You registered ${s} for the ${ctx.className} class and I just wanted to take a moment to
      reach out to you to say thank you.</p>
      <p>There are a lot of ways that you can choose to invest in ${s}'s future, and we're really
      honored that you've chosen Higher Ground Learning as one of them.</p>
      <p>Getting ready for university can be a challenging time for students, so by registering
      ${s} for our class you've given ${studentPronounSet(ctx).obj} one less thing to worry about.</p>
      <p>I know that, personally, I never would have even gone to university if it weren't for one
      person...</p>
      <p>My amazing mom.</p>
      <p>I certainly wouldn't have gone on to earn a Master's degree and definitely wouldn't be
      here right now, writing you this email.</p>
      <p>We don't take lightly the chance to work with ${s} and to help ${studentPronounSet(ctx).obj} achieve ${studentPronounSet(ctx).poss} best
      score on the test. And we really appreciate your vote of confidence in us.</p>
      <p>So here's what happens next.</p>
      <p>In the days before the course starts, you and ${s} will receive the necessary course
      information, such as ${classLocationPhrase(ctx)} and diagnostic test access.</p>
      <p>By the way, you might be interested in <a href="${COMPASS_URL}">College Prep Compass</a>,
      where we send out useful information to help you along in this process:</p>
      <ul style="padding-left:20px">
        <li>How ${s} can get the most out of the class,</li>
        <li>How to best take advantage of the free 30-minute strategy session,</li>
        <li>Common misconceptions and FAQs about the test,</li>
        <li>Which schools are test optional (and what's the difference between test optional and test blind),</li>
        <li>What to do about test anxiety,</li>
        <li>and more.</li>
      </ul>
      <p>By choosing to help ${s} prepare for this test, you've made a great investment in ${s}'s
      growth and future opportunities. We're humbled to be part of the journey, so thanks again.</p>
      <p>See you soon!</p>
      <p>To ${s}'s success,</p>
      <p>William Thomas<br/>President, Higher Ground Learning</p>
      <p>P.S. Here's what some other parents have said about our classes:</p>
      ${PARENT_TESTIMONIALS}`
}

export function thankYouEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    from: PERSONAL_FROM,
    subject: `Thank you, ${ctx.parentFirstName}`,
    html: wrap(thankYouBody(ctx), {
      preheader: `We're looking forward to working with ${ctx.studentFirstName}`,
      footer: footerR(ctx.unsubscribeUrl),
    }),
  }
}

// ---------------------------------------------------------------------------
// #9 — Tutoring Upsell (conditional) · ~24h after payment · billy@ · R
// ---------------------------------------------------------------------------

export function tutoringUpsellEmail(
  ctx: EnrollmentEmailContext,
  prePackages: TutoringPackage[],
  addonUrl: string
): Rendered {
  const s = ctx.studentFirstName
  const buttons = prePackages
    .map(
      (p) => `
      <p style="margin:8px 0">
        <a href="${addonUrl}" style="display:inline-block;background:#00AEEE;color:#fff;
        font-weight:bold;padding:10px 20px;border-radius:6px;text-decoration:none;min-width:260px;text-align:center">
        ${p.hours} hours — save $${packageSavings(p)}</a>
      </p>`
    )
    .join('')
  return {
    from: PERSONAL_FROM,
    subject: `We didn't want you to miss this`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>This is definitely not for every student. But so many people miss it and ask about it
      later when the discount is gone... so here's a quick reminder:</p>
      <p>After the ${ctx.className} class ends, a great way for ${s} to get even <em>bigger</em>
      point gains is through specialized 1-on-1 tutoring.</p>
      <p>Our 1-on-1 tutoring sessions are tailored to overcome ${s}'s specific weaknesses, exploit
      ${s}'s strengths, and refine strategies that are specific to ${s}'s situation. These sessions
      work in tandem with the group course, and are perfect for students who are taking the test
      multiple times, reaching for exceptionally high scores, or facing unique challenges.</p>
      <p>Spots always go quickly after the class ends, so we offer a discount and priority
      scheduling to parents who register early.</p>
      <p><em>If you know that ${s} is going to keep studying after the ${ctx.className} class ends,
      now is the best time to get these discounted 1-on-1 tutoring hours.</em></p>
      ${buttons}
      <p>These savings are only available before class starts!</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `A lot of people don't notice it`,
        footer: footerR(
          ctx.unsubscribeUrl,
          `Don't want to receive emails like this? We're sorry. This is actually the only one like it that we're planning to send to you.`
        ),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// #2-P / #2-S — Diagnostic Test Access · 10 days before · info@ · T
// ---------------------------------------------------------------------------

export function synapAccessParentEmail(ctx: EnrollmentEmailContext): Rendered {
  const s = ctx.studentFirstName
  const synap = synapUrl(ctx)
  return {
    subject: `Important ${ctx.className} diagnostic test information`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>The first full length remote diagnostic test for ${s} is now available. The exam is broken
      into two parts:</p>
      <ul style="padding-left:20px"><li>Reading &amp; Writing</li><li>Math</li></ul>
      <p>For a more realistic test experience, we strongly recommend that ${s} complete Part 1
      (Reading &amp; Writing), followed by Part 2 (Math) immediately afterward. The instructor will
      talk about the test during the first class session and will use students' results to tailor
      the course content and pace, so ${s} should complete the test by
      ${formatDate(ctx.diagnosticDueDate)}, the day before the first class.</p>
      <p><strong>To get started, just click the button below and then click "register." Quickly
      provide some basic info, and you'll be ready to access the test on our online testing
      system.</strong></p>
      <p>Invested in ${s}'s success,</p>
      <p>Higher Ground Learning</p>
      ${synap ? button('Access the first diagnostic test', synap) : ''}
      ${button('Download the course calendar', ctx.calendarPageUrl)}
    `,
      {
        preheader: `Here's how to access the first practice test.`,
        footer: footerT(),
      }
    ),
  }
}

export function synapAccessStudentEmail(ctx: EnrollmentEmailContext): Rendered {
  const synap = synapUrl(ctx)
  return {
    subject: `Your ${ctx.classType} diagnostic test is ready`,
    html: wrap(
      `
      <p>Hi ${ctx.studentFirstName},</p>
      <p>Your first diagnostic test is ready. It's in two parts — Reading &amp; Writing, then Math —
      and for the most realistic practice, do them back-to-back in one sitting.</p>
      <p><strong>Deadline: ${formatDate(ctx.diagnosticDueDate)}</strong> (the day before your first
      class). Your instructor uses the results to shape the course, so this one matters.</p>
      <p>To get in: click the button below, hit <strong>"register,"</strong> and provide some quick
      basic info. That creates your account on our testing platform and unlocks the test.</p>
      ${synap ? button('Take the diagnostic test', synap) : ''}
      <p>See you in class,<br/>Higher Ground Learning</p>
    `,
      {
        preheader: `Finish it by ${formatDate(ctx.diagnosticDueDate)} — here's how to get in.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// #3 — VFAQs · 7 days before · both (pronouns in sign-off) · info@ · R
// ---------------------------------------------------------------------------

export function faqEmail(ctx: EnrollmentEmailContext, audience: Audience): Rendered {
  const isStudent = audience === 'student'
  const synap = synapUrl(ctx)
  const examFaq = ctx.examInfo
    ? `NO. You must register for official exams through the
       <a href="${ctx.examInfo.regUrl}">${ctx.examInfo.regLabel}</a>.`
    : `NO. You must register for official exams through the official testing organization's website.`
  const examName = ctx.examInfo?.examName ?? 'official exam'
  return {
    subject: `${ctx.className} – here are some VFAQs`,
    html: wrap(
      `
      <p>Hey ${recipientFirstName(ctx, audience)},</p>
      <p>The ${ctx.className} class is just around the corner, so I want to give you some key
      information to keep in mind. Below are some VFAQs (Very Frequently Asked Questions):</p>
      <p><strong>What time are classes scheduled?</strong><br/>
      All classes are held from ${classTimeHtml(ctx)}. You can download the full calendar of class
      dates <a href="${ctx.calendarPageUrl}">here</a>.</p>
      <p><strong>Does enrolling in this course also register me for the ${examName}?</strong><br/>
      ${examFaq}</p>
      <p><strong>What's the exact location for the class?</strong><br/>
      We don't have that information confirmed just yet, but we'll write you again when we know!</p>
      <p>Are you still here? You are? Okay, here are a few regular FAQs, just for you:</p>
      <p><strong>What if I didn't get the diagnostic test information?</strong><br/>
      No problem — you can get to it right here:</p>
      ${synap ? button('Take the diagnostic test', synap) : ''}
      <p>It's due ${formatDate(ctx.diagnosticDueDate)}, the day before your first class. (It also
      went to your inbox, so it's worth a search of your spam folder for next time.)</p>
      <p><strong>What is the 30-minute strategy session? And when can I schedule it?</strong><br/>
      Each student receives one strategy session with enrollment, during which the instructor will
      help you craft an individualized study and review plan, build a perfect test-day mindset,
      understand your diagnostic score report, or go over day-of test strategies.</p>
      <p>The strategy sessions usually work best when they're done after the first week of classes,
      at the earliest. During the first class sessions, you can approach the instructor directly to
      find and schedule a time during the following week that's mutually agreeable. If you'd like
      to or need to do the strategy session earlier, however, just let us know and we can try to
      arrange it.</p>
      <p><strong>I'm going to miss a class, show up late, and/or leave early. What should I do?</strong><br/>
      Check with your instructor to get the lesson plan, materials, and homework. You can follow-up
      with the instructor afterward if you have any questions about the material.</p>
      <p>All online class sessions are recorded and shared with students after the class ends.
      Again, you can follow-up with the instructor afterward if you have any questions about the
      material.</p>
      <p>If you've signed up for 1-on-1 tutoring, you can also use this time to go over any lessons
      that you missed.</p>
      <p>P.S. In case you have a question that wasn't answered here, here are even more course
      FAQs:</p>
      <p>${FAQ_LINKS}</p>
      <p>Invested in ${isStudent ? 'your' : `${ctx.studentFirstName}'s`} success,</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `You know, VERY Frequently Asked Questions`,
        footer: footerR(
          ctx.unsubscribeUrl,
          `Sorry if this was annoying, but please don't unsubscribe yet because we're still planning to send you at least one more important communication about the class.`
        ),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// #4 — Class Details · 4 days before · both (pronouns) · info@ · T
// ---------------------------------------------------------------------------

export function classDetailsEmail(ctx: EnrollmentEmailContext, audience: Audience): Rendered {
  const isStudent = audience === 'student'
  const s = ctx.studentFirstName
  const synap = synapUrl(ctx)
  return {
    subject: `${ctx.className} Reminder`,
    html: wrap(
      `
      <h2 style="color:#334155">It's almost class time.</h2>
      <p>Hi ${recipientFirstName(ctx, audience)},</p>
      <p>I think you already know, but just in case...</p>
      <p>The ${ctx.className} class ${isStudent ? '' : `for ${s} `}is coming up soon! (The first
      day is ${formatDate(ctx.firstSession)} from ${classTimeHtml(ctx)}.)</p>
      <p>The instructor will be ${ctx.instructorName}, and <strong>all classes will take place
      ${classLocationTailText(ctx.defaultLocation, ctx.deliveryMode)}</strong>.</p>
      <p>We're looking forward to seeing ${isStudent ? 'you' : s} in class!</p>
      <p>All the best,</p>
      <p>Higher Ground Learning</p>
      <p>P.S. If ${isStudent ? "you haven't" : `${s} hasn't`} found a moment to take the diagnostic
      test yet, ${isStudent ? 'you' : studentPronounSet(ctx).subj} can still do so by clicking below. If
      ${isStudent ? 'you have' : `${studentPronounSet(ctx).subj} ${studentPronounSet(ctx).have}`} already completed the test, no need to let us know.
      We surely have it.</p>
      ${synap ? button('Access Diagnostic Tests', synap) : ''}
    `,
      {
        preheader: `Class starts soon! Open to see where classes will be held.`,
        footer: footerT(`We're still planning to send you a few more important communications about the class.`),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// #5 — Location Reminder · 1 day before, 11:00 · both (pronouns) · info@ · T
// ---------------------------------------------------------------------------

// PL-67: audience- and tense-aware #6 opening clause (twin of the registry's
// {takingAdvantagePhrase} variable) — "has been taking advantage" only makes
// sense while class time remains; after the last session it reads "was able
// to take advantage". First name only: later mentions of the instructor
// drop the surname (#4/LR introduce with the full name).
function takingAdvantagePhrase(ctx: EnrollmentEmailContext, audience: Audience): string {
  const first = ctx.instructorName?.trim().split(/\s+/)[0] || 'the instructor'
  const ended = new Date().toISOString().slice(0, 10) > (ctx.lastSession ?? '')
  const isStudent = audience === 'student'
  const who = isStudent ? 'you' : ctx.studentFirstName
  const poss = isStudent ? 'your' : studentPronounSet(ctx).poss
  const verb = ended
    ? isStudent
      ? 'were able to take advantage'
      : 'was able to take advantage'
    : isStudent
      ? 'have been taking advantage'
      : 'has been taking advantage'
  return `${who} ${verb} of ${poss} class time with ${first}`
}

// PL-58: delivery-mode-aware location phrasing (twin of the registry's
// {classLocationPhrase} variable).
function classLocationPhrase(ctx: EnrollmentEmailContext): string {
  return ctx.deliveryMode === 'online' ? 'the meeting link for class' : 'the classroom location'
}

export function locationReminderEmail(ctx: EnrollmentEmailContext, audience: Audience): Rendered {
  const isStudent = audience === 'student'
  const s = ctx.studentFirstName
  const synap = synapUrl(ctx)
  // PL-65: an online class's family gets "Meeting link", not "Classroom
  // location" — the portal knows the delivery mode.
  const noun = ctx.deliveryMode === 'online' ? 'Meeting link' : 'Classroom location'
  return {
    subject: `${noun} for ${ctx.className}`,
    html: wrap(
      `
      <h2 style="color:#334155">Class starts soon!</h2>
      <p><em>Like, really soon.</em></p>
      <p>Hey ${recipientFirstName(ctx, audience)},</p>
      <p>Sorry for so many messages, but we really wanted to make sure that
      ${isStudent ? "you don't" : `${s} doesn't`} miss the first day of ${ctx.className}!</p>
      <p>So here you go...one last reminder: the first day of class is
      ${formatDate(ctx.firstSession)} from ${classTimeHtml(ctx)}.</p>
      <p><strong>All classes take place ${classLocationTailText(ctx.defaultLocation, ctx.deliveryMode)}</strong></p>
      <p>Looking forward to seeing ${isStudent ? 'you' : s} in class!</p>
      <p>P.S. If ${isStudent ? "you still haven't" : `${s} still hasn't`} taken the first
      diagnostic test, don't worry. It's still available
      ${synap ? `<a href="${synap}">here</a>` : `via the link in your diagnostic test email`}.</p>
    `,
      {
        preheader: `Open up to see ${ctx.deliveryMode === 'online' ? 'the meeting link for class' : 'the classroom location'}.`,
        footer: footerT(`You received this email because you signed up for a class that starts really soon and we didn't want you to miss it.`),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// #6 — 2nd Diagnostic Reminder · 7 days after start · both (pronouns) · info@ · R
// ---------------------------------------------------------------------------

export function secondDiagnosticEmail(ctx: EnrollmentEmailContext, audience: Audience): Rendered {
  const isStudent = audience === 'student'
  const s = ctx.studentFirstName
  const synap = synapUrl(ctx)
  return {
    subject: `2nd Diagnostic Reminder for ${ctx.className}`,
    html: wrap(
      `
      <p>Dear ${recipientFirstName(ctx, audience)},</p>
      <p>I sincerely hope that ${takingAdvantagePhrase(ctx, audience)} to the fullest.</p>
      <p>As a friendly reminder, there is still one more diagnostic test
      ${isStudent ? 'for you' : `for ${s}`} to take!</p>
      <p>Just like before, ${isStudent ? 'you' : s} can click
      ${synap ? `<a href="${synap}">here</a>` : `the link in your diagnostic test email`} to login
      to our online testing platform and access the test.</p>
      <p>Kind regards,</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `Taking practice tests leads to better scores.`,
        footer: footerR(ctx.unsubscribeUrl),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// #7 — Review Request · 1 day after final session · billy@ · R
// ---------------------------------------------------------------------------

export function reviewRequestEmail(ctx: EnrollmentEmailContext): Rendered {
  const s = ctx.studentFirstName
  return {
    from: PERSONAL_FROM,
    subject: `How did the ${ctx.className} class go?`,
    html: wrap(
      `
      <p>Hi again ${ctx.parentFirstName},</p>
      <p>Now that the ${ctx.className} class has wrapped up, ${s} should be feeling a lot more
      confident and ready to do ${studentPronounSet(ctx).poss} best on the exam!</p>
      <p>Congrats to ${s} for ${studentPronounSet(ctx).poss} hard work and commitment to improvement.</p>
      <p>${ctx.parentFirstName}, I know it's a lot to ask, but if you have something nice to say
      and you don't mind publicly sharing it, we'd be really grateful if you could leave us a
      review here:</p>
      <p><a href="${REVIEW_URL}">${REVIEW_URL}</a></p>
      <p>Thanks in advance if you can spare a few minutes!</p>
      <p>To ${s}'s bright future,</p>
      <p>William Thomas</p>
      ${button('Tell us how you feel', REVIEW_URL)}
    `,
      {
        preheader: `Tell us how we did — it genuinely helps.`,
        footer: footerR(
          ctx.unsubscribeUrl,
          `...we're a small company and we have a theory that a nice review from someone like you could really help us to help more students.`
        ),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// #8 — Post-Class Tutoring Offer · 4 days after final session · billy@ · R
// (same copy to both audiences; only the greeting name differs)
// ---------------------------------------------------------------------------

export function tutoringOfferEmail(
  ctx: EnrollmentEmailContext,
  _postPackages: TutoringPackage[],
  audience: Audience = 'parent'
): Rendered {
  const s = ctx.studentFirstName
  const instructor = ctx.instructorName ?? 'the instructor'
  return {
    from: PERSONAL_FROM,
    subject: `Discounted 1-on-1 Tutoring for students who took the ${ctx.className} Class`,
    html: wrap(
      `
      <p>Hello again ${recipientFirstName(ctx, audience)}!</p>
      <p>I hope that the recent ${ctx.classType} class with ${instructor} was useful for ${s}
      (and maybe even a little bit fun).</p>
      <p>The idea behind our classes is that ${s} should now have the tools ${studentPronounSet(ctx).subj} ${studentPronounSet(ctx).need} to be
      successful on the test. Of course, we know that some students will continue to study and
      refine their skills for a future test.</p>
      <p>With that in mind, we offer students who have completed one of our classes discounted
      1-on-1 tutoring hours. We don't expect that this option is appropriate for all students, but
      we provide it as a service in case ${s} wants to continue studying with us.</p>
      <p><strong>You can access discounted tutoring at
      <a href="${DISCOUNT_URL}">highergroundprep.com/discount</a> by using the password
      BESTSCORE.</strong></p>
      <p>If you sign up, we'll get input from ${instructor} to make sure that ${s}'s transition
      from the class to live online tutoring is seamless and ${studentPronounSet(ctx).subj} ${studentPronounSet(ctx).dont} lose any momentum with
      ${studentPronounSet(ctx).poss} test prep before the real test.</p>
      <p>We'll also get in touch with you and/or ${s} to make sure that the sessions are timed
      perfectly for whenever you need them to be.</p>
      <p>If you have any questions, feel free to respond to this email!</p>
      <p>In ${s}'s corner, as always,</p>
      <p>William</p>
      ${button('Get your discounted tutoring hours', DISCOUNT_URL)}
    `,
      {
        preheader: `Keep ${s}'s momentum going before test day.`,
        footer: footerR(
          ctx.unsubscribeUrl,
          `You received this email because we genuinely thought it might interest you. You could always unsubscribe.`
        ),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// PL-59: waitlist release when a class COMPLETES still-full — the common case
// CX-W never covered (the class ran; the waitlisted family simply never
// heard). Approved copy: honest close-out + a deliberate 1-on-1 offer
// ("someone who wanted SAT prep from us and was willing to pay — help them
// out asap") + the same "you'll hear first" promise, backed by the PL-54
// interest list. No pricing here — that's the scheduling conversation.
// ---------------------------------------------------------------------------

export function waitlistReleaseEmail(ctx: EnrollmentEmailContext, contactHtml: string): Rendered {
  const s = ctx.studentFirstName
  return {
    subject: `An update on ${ctx.schoolNickname} ${ctx.classType} — and an option for ${s}`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>An update on ${ctx.schoolNickname} ${ctx.classType}: the class stayed full, and we
      weren't able to open up a place for ${s}. No payment was ever taken, and I'm sorry it
      didn't work out this time.</p>
      <p>If ${s} still wants to get ready, we can help right away with
      <strong>1-on-1 tutoring</strong> — the same prep, tailored entirely to ${s}, scheduled
      around your family. <a href="${ctx.availabilityUrl}" style="color:#00AEEE">Share your
      availability</a> and we'll propose times, or just reply and we'll talk it through.</p>
      <p>And either way, you're still on our list — the moment a new ${ctx.schoolNickname}
      ${ctx.classType} course opens, you'll be the first to know. Nothing to do on your end.</p>
      ${contactHtml}
    `,
      { preheader: "We couldn't open a spot — but we can still help right away.", footer: footerT() }
    ),
  }
}

// ---------------------------------------------------------------------------
// PL-54c: the interest-list notify — "you asked us to tell you first". Sent
// from info@ when the Ops Director confirms the admin prompt for a newly
// opened class. Short and warm; first-come-first-served implied, not stated.
// ---------------------------------------------------------------------------

export function nextClassOpenEmail(
  ctx: EnrollmentEmailContext,
  opts: { classSummaryLine: string; registrationLink: string; contactHtml: string }
): Rendered {
  return {
    subject: `A new ${ctx.schoolNickname} ${ctx.classType} class just opened`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>You asked us to let you know when the next ${ctx.schoolNickname} ${ctx.classType}
      course opened — it's open now:</p>
      <p>${opts.classSummaryLine}</p>
      ${button('See details & register', opts.registrationLink)}
      <p>Spots fill in order of registration, so don't wait too long.</p>
      ${opts.contactHtml}
    `,
      { preheader: 'You asked us to tell you first — here it is.', footer: footerT() }
    ),
  }
}

// ---------------------------------------------------------------------------
// PL-53c: the #8 fork for families who ALREADY BOUGHT add-on hours — a sales
// pitch to them was the latent bug in the original #8. This is "time to put
// your hours to work": hours remaining + the availability link (or the
// ready-to-propose variant when availability is on file). Sent from the
// configured tutoring contact (PL-50) — the caller supplies from/contactHtml
// to avoid an email.ts ↔ tutoring-emails import cycle.
// ---------------------------------------------------------------------------

export function schedulingCtaBlockHtml(ctx: EnrollmentEmailContext, hasAvailability: boolean): string {
  return hasAvailability
    ? `<p>We already have your availability on file, so we're ready to propose times — expect to
      hear from us shortly, or reply now if you'd like to get going today.</p>`
    : `<p>To get started, just tell us when ${ctx.studentFirstName} is usually free —
      <a href="${ctx.availabilityUrl}" style="color:#00AEEE">share your availability</a> (about a
      minute) and we'll propose times that fit.</p>`
}

export function e8AddonSchedulingEmail(
  ctx: EnrollmentEmailContext,
  opts: { hoursRemaining: number; hasAvailability: boolean; from: string; contactHtml: string }
): Rendered {
  const s = ctx.studentFirstName
  return {
    from: opts.from,
    subject: `Time to put ${s}'s tutoring hours to work`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>Now that the ${ctx.className} class has wrapped up, this is the moment ${s}'s 1-on-1
      tutoring is built for — a tutor can pick up exactly where the class left off, focused on
      what ${s} needs next.</p>
      <p><strong>You have ${opts.hoursRemaining} tutoring hour${opts.hoursRemaining === 1 ? '' : 's'} ready to use.</strong></p>
      ${schedulingCtaBlockHtml(ctx, opts.hasAvailability)}
      ${opts.contactHtml}
    `,
      {
        preheader: `${opts.hoursRemaining} hour${opts.hoursRemaining === 1 ? '' : 's'} ready — let's get ${s} scheduled.`,
        footer: footerT(),
      }
    ),
  }
}

/** PL-53c: one gentle nudge ~7 days after the scheduling email if the family
 *  still hasn't shared availability or scheduled. Never escalates further by
 *  email — the +14-day step is an Ops Director alert, not another send. */
export function e8AddonNudgeEmail(
  ctx: EnrollmentEmailContext,
  opts: { hoursRemaining: number; from: string; contactHtml: string }
): Rendered {
  const s = ctx.studentFirstName
  return {
    from: opts.from,
    subject: `${s}'s tutoring hours are waiting when you are`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>Just a gentle reminder that ${s} still has
      <strong>${opts.hoursRemaining} tutoring hour${opts.hoursRemaining === 1 ? '' : 's'}</strong> ready to use —
      no rush, and they don't expire on you.</p>
      <p>Whenever you're ready,
      <a href="${ctx.availabilityUrl}" style="color:#00AEEE">share ${s}'s availability</a> and
      we'll propose times — or just reply and we'll sort it out together.</p>
      ${opts.contactHtml}
    `,
      { preheader: `No rush — just don't let good hours gather dust.`, footer: footerT() }
    ),
  }
}

// ---------------------------------------------------------------------------
// W1 — Waitlist Confirmation · instant · info@ · T
// ---------------------------------------------------------------------------

export function waitlistConfirmationEmail(ctx: EnrollmentEmailContext, position: number): Rendered {
  const s = ctx.studentFirstName
  return {
    subject: `You're on the waitlist for ${ctx.className}`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>The ${ctx.className} class is currently full — but ${s} is officially on the waitlist, at
      position <strong>#${position}</strong>.</p>
      <p>Here's how it works: spots occasionally open up (plans change, they really do), and when
      one does, we offer it to the next family in line. If that's you, you'll get an email with a
      registration link, and you'll have <strong>48 hours</strong> to complete registration and
      payment before the spot moves to the next person.</p>
      <p>Nothing to do right now — we'll be in touch the moment a spot opens. No payment has been
      taken and you're under no obligation.</p>
      <p>Questions in the meantime? Just reply to this email.</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `${s} is #${position} in line — here's how this works.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// W2 — Spot Available · when spot opens · info@ · T
// ---------------------------------------------------------------------------

export function waitlistOfferEmail(
  ctx: EnrollmentEmailContext,
  claimUrl: string,
  expiresAt: string,
  declineUrl: string
): Rendered {
  const s = ctx.studentFirstName
  const deadline = zonedDeadline(expiresAt, ctx.timezone)
  return {
    subject: `A spot just opened in ${ctx.className} 🎉`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>Good news — a spot just opened up in the ${ctx.className} class, and ${s} is next in
      line.</p>
      <p><strong>The spot is yours if you complete registration by ${deadline}.</strong> After
      that, we'll need to offer it to the next family on the waitlist — so don't sit on this one
      too long!</p>
      ${button(`Claim ${s}'s spot`, claimUrl)}
      <p>A quick recap: the class starts ${formatDate(ctx.firstSession)}, ${classTimeHtml(ctx)}.
      Once you register, you'll receive all the usual course information — diagnostic test access,
      location details, and everything else — in the days before class starts. If registration
      happens close to the start date, we'll send you everything you need right away.</p>
      <p>If your plans have changed and you no longer need the spot,
      <a href="${declineUrl}" style="color:#00AEEE">click here to let us know</a>. It'll also pass
      to the next family automatically after the deadline.</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `It's ${s}'s if you want it — you have 48 hours.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// SU — Schedule Update · on change after #4 sent · both · info@ · T
// ---------------------------------------------------------------------------

export type ScheduleChange = { label: string; value: string }

export function scheduleUpdateEmail(
  ctx: EnrollmentEmailContext,
  audience: Audience,
  changes: ScheduleChange[]
): Rendered {
  const changesBlock = changes
    .map((c) => `<li><strong>${c.label}:</strong> now ${c.value}</li>`)
    .join('')
  return {
    subject: `Schedule update for ${ctx.className}`,
    html: wrap(
      `
      <p>Hi ${recipientFirstName(ctx, audience)},</p>
      <p>A quick update about the ${ctx.className} class — some details have changed since our last
      email, and we want to make sure you have the latest:</p>
      <ul style="padding-left:20px">${changesBlock}</ul>
      <p>Everything else stays the same. The full up-to-date schedule is always here:</p>
      ${button('View the class calendar', ctx.calendarPageUrl)}
      <p><em>(And if you subscribed to the calendar, it's already updated automatically.)</em></p>
      <p>Sorry for any shuffling — see you in class!</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `One or two details have changed — here's the latest.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// LR — Late Registration Welcome · instant on payment when signup postdates
// pre-start emails · both (pronouns) · info@ · T. Replaces the missed
// #1/#2/#3 sends; the parent version also carries the #0-style order summary
// block (this email replaces the normal confirmation flow's spacing).
// ---------------------------------------------------------------------------

export function lateRegistrationWelcomeEmail(
  ctx: EnrollmentEmailContext,
  audience: Audience
): Rendered {
  const isStudent = audience === 'student'
  const s = ctx.studentFirstName
  const synap = synapUrl(ctx)

  const classDetailsBlock =
    ctx.instructorName && ctx.defaultLocation
      ? `The instructor will be ${ctx.instructorName}, and classes take place ${classLocationTailText(ctx.defaultLocation, ctx.deliveryMode)}.`
      : `We'll send classroom and instructor details as soon as they're confirmed.`

  const addonLines = ctx.addons
    .map((a) => `<br/>${a.name} — 1-on-1 Tutoring — $${a.pricePaid}`)
    .join('')
  const detail = (label: string, value: string | null) =>
    `<br/><strong>${label}:</strong> ${value && value.trim() ? value : '—'}`
  const orderSummary = isStudent
    ? ''
    : `
      <h3 style="color:#334155">Enrollment Summary</h3>
      <p>${ctx.className} — $${ctx.price}${addonLines}
      <br/><strong>Amount paid:</strong> ${ctx.amountPaid != null ? `$${ctx.amountPaid}` : `$${ctx.price}`}
      · ${ctx.paidAt ? formatDate(ctx.paidAt.slice(0, 10)) : ''}</p>
      <h3 style="color:#334155">Registration Details</h3>
      <p><strong>Student:</strong> ${ctx.studentFirstName} ${ctx.studentLastName}
      ${detail('Student email', ctx.studentEmail)}
      ${detail('School', ctx.schoolName)}
      ${detail('Graduating year', ctx.graduatingYear)}
      ${detail('Testing accommodations', ctx.accommodations)}
      ${detail('Previous test scores', ctx.previousScores)}
      ${detail('Notes', ctx.notes)}</p>`

  return {
    subject: `You're in — and here's everything you need for ${ctx.className}`,
    html: wrap(
      `
      <p>Hi ${recipientFirstName(ctx, audience)},</p>
      <p>${isStudent ? "You're" : `${s} is`} registered for the ${ctx.className} class — and since
      the class starts <strong>${formatDate(ctx.firstSession)}</strong>, here's everything you need
      in one email.</p>
      <p><strong>1. The diagnostic test — this one's time-sensitive.</strong><br/>
      ${isStudent ? 'Your' : `${s}'s`} first diagnostic test is ready now. It's in two parts
      (Reading &amp; Writing, then Math), best done back-to-back in one sitting. The instructor
      uses the results to shape the course, so please complete it <strong>before the first
      class</strong> if at all possible.</p>
      <p>To get ${isStudent ? 'you' : s} in: click below, hit "register," and provide some quick
      basic info${isStudent ? '' : ` — you can do it together or just pass this along to ${s}`}.</p>
      ${synap ? button('Take the diagnostic test', synap) : ''}
      <p><strong>2. When and where.</strong><br/>
      Classes run ${classTimeHtml(ctx)}. ${classDetailsBlock}</p>
      <p>Full schedule:</p>
      ${button('View the class calendar', ctx.calendarPageUrl)}
      <p><strong>3. Good things to know.</strong><br/>
      Quick answers to the most common questions — class times, what to do if
      ${isStudent ? 'you miss' : `${s} misses`} a session, the free 30-minute strategy session —
      are in our <a href="https://highergroundlearning.com/faqs#general">FAQs</a>.</p>
      <p>Any other questions, just reply to this email. See you in class — soon!</p>
      <p>Higher Ground Learning</p>
      ${orderSummary}
    `,
      {
        preheader: `Class starts ${formatDate(ctx.firstSession)}. One thing to do first.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// Phase 4 school-contact emails — FINAL COPY from
// docs/PHASE4_COUNSELOR_EMAIL_COPY.md (v1.0, July 6). All five: From info@,
// Footer T. Recipient-facing wording says "school contact", never
// "counselor" (contacts are sometimes principals or admin assistants);
// code/table names keep "counselor".
// ---------------------------------------------------------------------------

// Pluralization helpers (deck implementation notes) — render from counts.
const plS = (n: number) => (n === 1 ? '' : 's')
const plEs = (n: number) => (n === 1 ? '' : 'es')
const isAre = (n: number) => (n === 1 ? 'is' : 'are')

/** CR footer: "school contact" wording per the deck. */
function schoolContactFooter(schoolName: string) {
  return footerT(
    `You received this email because you're the school contact for this class at ${schoolName}.`
  )
}

// ---------------------------------------------------------------------------
// CD — Counselor Enrollment Digest · per digest_frequency · info@ · T +
// frequency links ("pause" is the control; no unsubscribe on transactional)
// ---------------------------------------------------------------------------

export type DigestClassInfo = {
  label: string
  classType: string
  firstSession: string
  paid: number
  capacity: number
  waitlistDepth: number
  newSinceLast: number
  regUrl: string
  /** Portal link for the Phase 4.5 flyer + letter downloads (auth-gated —
   *  links, never attachments, so the files can't go stale in an inbox). */
  materialsUrl?: string
  /** §8 regeneration notice: a collateral-visible detail changed since the
   *  counselor's last digest — posted copies are stale. */
  materialsUpdated?: boolean
}

// PL-66: the digest's composed pieces, exported so the registry send path can
// pass them as block variables while the code twin renders identically.
export function digestClassListHtml(classes: DigestClassInfo[]): string {
  // One card per class; single-class schools render one.
  return classes
    .map(
      (c) => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:10px 0">
        <p style="margin:0 0 4px"><strong>${c.classType} — starts ${formatDate(c.firstSession)}</strong></p>
        <p style="margin:0;color:#475569">Enrolled: <strong>${c.paid} of ${c.capacity}</strong>
        (${c.newSinceLast} new since last update) · Waitlist: ${c.waitlistDepth}</p>
        <p style="margin:6px 0 0;font-size:13px">Registration link to share:
        <a href="${c.regUrl}">${c.regUrl}</a></p>
        ${
          c.materialsUpdated && c.materialsUrl
            ? `<p style="margin:6px 0 0;font-size:13px;color:#b45309"><strong>Class
        materials updated</strong> — details on the flyer or parent letter changed, so
        please <a href="${c.materialsUrl}">re-download</a> and replace any posted copies.</p>`
            : ''
        }
        ${
          c.materialsUrl && !c.materialsUpdated
            ? `<p style="margin:6px 0 0;font-size:13px">Class materials (flyer for
        bulletin boards &amp; screens, parent letter to forward) are in
        <a href="${c.materialsUrl}">your portal</a> — always current, so
        re-download rather than reusing saved copies.</p>`
            : ''
        }
      </div>`
    )
    .join('')
}

export function digestSubjectCount(classes: DigestClassInfo[]): string {
  // The class's count for single-class schools; multi-class schools say
  // "2 classes, 17 students" so the total can't read as one class's headcount.
  const totalPaid = classes.reduce((sum, c) => sum + c.paid, 0)
  const nClasses = classes.length
  return nClasses === 1
    ? `${totalPaid} student${plS(totalPaid)} enrolled`
    : `${nClasses} class${plEs(nClasses)}, ${totalPaid} student${plS(totalPaid)} enrolled`
}

export function digestFrequencyHtml(f: {
  weekly: string
  biweekly: string
  monthly: string
  paused: string
}): string {
  return `<p style="font-size:13px;color:#64748b">How often do you want these?
          <a href="${f.weekly}" style="color:#64748b">Weekly</a> ·
          <a href="${f.biweekly}" style="color:#64748b">Every 2 weeks</a> ·
          <a href="${f.monthly}" style="color:#64748b">Monthly</a> ·
          <a href="${f.paused}" style="color:#64748b">Pause</a></p>`
}

export function counselorDigestEmail(opts: {
  counselorFirst: string
  schoolName: string
  schoolNickname: string
  classes: DigestClassInfo[]
  frequencyUrls: { weekly: string; biweekly: string; monthly: string; paused: string }
}): Rendered {
  const classListBlock = digestClassListHtml(opts.classes)
  const subjectCount = digestSubjectCount(opts.classes)
  return {
    subject: `${opts.schoolNickname} enrollment update — ${subjectCount}`,
    html: wrap(
      `
      <p>Hi ${opts.counselorFirst},</p>
      <p>Here's where enrollment stands for the upcoming Higher Ground Learning
      class${plEs(opts.classes.length)} at ${opts.schoolName}:</p>
      ${classListBlock}
      <p>Know a student who's still on the fence? Forwarding them (or their parents) the
      registration link is the single most helpful thing you can do — everything after the
      click is automatic.</p>
      <p>Questions about any student or class? Just reply to this email.</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `Your students' class registrations, at a glance.`,
        footer: `${digestFrequencyHtml(opts.frequencyUrls)}
          <p style="font-size:13px;color:#64748b">Higher Ground Learning · highergroundlearning.com</p>`,
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// FP — Final-Days Push · daily, last 3 days before enrollment deadline ·
// info@ · T. Replaced by FP-alt when paid count reaches capacity.
// ---------------------------------------------------------------------------

export function deadlinePushEmail(opts: {
  counselorFirst: string
  label: string
  spotsLeft: number
  daysToDeadline: number
  paidCount: number
  capacity: number
  regUrl: string
}): Rendered {
  const d = opts.daysToDeadline
  const n = opts.spotsLeft
  return {
    subject: `${d === 1 ? 'Last day' : `${d} days left`} to register for ${opts.label}`,
    html: wrap(
      `
      <p>Hi ${opts.counselorFirst},</p>
      <p>Quick heads-up: registration for the ${opts.label} class closes in
      <strong>${d} day${plS(d)}</strong>, and there ${isAre(n)} still
      <strong>${n} spot${plS(n)}</strong> open.</p>
      <p>This is the window where a nudge from the school makes the difference — parents who've
      been meaning to register usually just need one reminder, and one from you carries real
      weight.</p>
      <p>Here's the link, ready to forward:</p>
      <p><a href="${opts.regUrl}">${opts.regUrl}</a></p>
      <p>Current count: ${opts.paidCount} of ${opts.capacity} enrolled. After the deadline,
      late registrations may still be possible while spots remain, but the class calendar and
      materials go out on schedule — so sooner really is better.</p>
      <p>Thanks for the assist!</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `${n} spot${plS(n)} left — a nudge from you goes a long way.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// FP-alt — Class Full · one-off, fires instead of the FP series when paid
// count = capacity · info@ · T
// ---------------------------------------------------------------------------

export function classFullNoticeEmail(opts: {
  counselorFirst: string
  label: string
  capacity: number
  waitlistDepth: number
  regUrl: string
}): Rendered {
  return {
    subject: `${opts.label} is full 🎉`,
    html: wrap(
      `
      <p>Hi ${opts.counselorFirst},</p>
      <p>Good news: the ${opts.label} class is <strong>full</strong> — all ${opts.capacity}
      spots are taken. Thanks for helping spread the word!</p>
      <p>If more students ask about it, the registration page now offers a
      <strong>waitlist</strong> (${opts.waitlistDepth} on it so far). Spots do occasionally
      open up, and waitlisted families are offered them automatically, first come, first
      served — so it's genuinely worth joining. And if the waitlist grows large enough, we'll
      often try to free up another instructor and open a <strong>second section</strong>
      running alongside this one — so keep sending interested families to the link; real
      demand is exactly what makes that happen.</p>
      <p>Same link as always: <a href="${opts.regUrl}">${opts.regUrl}</a></p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `Great news — and here's what to tell latecomers.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// Instructor scheduling nudge (addendum §7.4) — INTERNAL, info@ → info@.
// Fires once when paid enrollments reach the class minimum and no instructor
// is assigned; re-nudges at 11 and 8 days before the first session (the
// classroom-request cadence), backstopping well before #4's 4-day hold.
// ---------------------------------------------------------------------------

export function instructorNudgeEmail(opts: {
  label: string
  schoolName: string
  paidCount: number
  minEnrollment: number
  firstSession: string
  adminUrl: string
  /** 0 = initial, 1/2 = re-nudges */
  nudge: number
}): Rendered {
  const subject =
    opts.nudge === 0
      ? `Instructor needed — ${opts.label} reached minimum enrollment`
      : `Reminder ${opts.nudge}: ${opts.label} still has no instructor (starts ${formatDate(opts.firstSession)})`
  return {
    subject: `[HGL Admin] ${subject}`,
    html: wrap(
      `
      <h2 style="color:#334155">${subject}</h2>
      <p><strong>${opts.label}</strong> (${opts.schoolName}) has
      <strong>${opts.paidCount} paid</strong> enrollments against a minimum of
      <strong>${opts.minEnrollment}</strong> — the class is running, and no instructor is
      assigned yet.</p>
      <p>First session: <strong>${formatDate(opts.firstSession)}</strong>.</p>
      <p><a href="${opts.adminUrl}">Open the admin class view</a> and select an instructor
      from the dropdown — or add a new one — so the class-details email can go out on
      schedule.</p>
    `,
      {
        preheader: `${opts.paidCount} paid / ${opts.minEnrollment} minimum — assign an instructor`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// CR1/CR2/CR3 — Classroom Request + re-nudges · 14d / 11d / 8d before start ·
// info@ · T (single-question tokenized form, no login)
// ---------------------------------------------------------------------------

export function classroomRequestEmail(opts: {
  counselorFirst: string
  schoolNickname: string
  schoolName: string
  classType: string
  firstSession: string
  formUrl: string
  nudge: number // 0 = CR1 first ask, 1 = CR2, 2 = CR3 (final)
}): Rendered {
  const label = `${opts.schoolNickname} ${opts.classType}`
  const firstDay = formatDate(opts.firstSession)
  const cta = button('Tell us the room', opts.formUrl)
  const footer = schoolContactFooter(opts.schoolName)

  if (opts.nudge === 0) {
    return {
      subject: `Where will ${label} be held?`,
      html: wrap(
        `
        <p>Hi ${opts.counselorFirst},</p>
        <p>The ${label} class starts on ${firstDay}, and there's exactly one thing we still
        need before we can send families their "here's where to go" email:</p>
        <p><strong>A room.</strong></p>
        <p>If you can reserve a space on campus and tell us where it is, we'll handle
        everything else — the location goes out automatically to every registered family, onto
        the class calendar, and into all the reminder emails.</p>
        ${cta}
        <p>It's a single question ("Room C19 in the high school" is a perfect answer) — just
        type it in and hit submit, and you're done.</p>
        <p>Thanks for making this class possible!</p>
        <p>Higher Ground Learning</p>
      `,
        { preheader: `One quick question — takes about 20 seconds.`, footer }
      ),
    }
  }

  if (opts.nudge === 1) {
    return {
      subject: `Still need a room for ${label}`,
      html: wrap(
        `
        <p>Hi ${opts.counselorFirst},</p>
        <p>Just circling back — the ${label} class starts ${firstDay}, and we still don't have
        a room to tell families about.</p>
        <p>We know reserving campus space sometimes takes a little legwork, so no stress if
        it's in progress. The moment you know, just drop it here:</p>
        ${cta}
        <p>One question, ten seconds, and we take it from there.</p>
        <p>Higher Ground Learning</p>
      `,
        { preheader: `Class starts ${firstDay} — 20 seconds fixes this.`, footer }
      ),
    }
  }

  return {
    subject: `Last call: room needed for ${label}`,
    html: wrap(
      `
      <p>Hi ${opts.counselorFirst},</p>
      <p>Last nudge, we promise — in a few days we're scheduled to email every registered
      family with the class location for ${label} (first day: ${firstDay}), and right now that
      email would say "location TBD" — we'd love to give them something better.</p>
      ${cta}
      <p>If there's a snag on your end — no rooms available, room reservations are handled by
      someone else at your school, anything — just reply to this email and one of our team
      will help sort it out.</p>
      <p>Higher Ground Learning</p>
    `,
      { preheader: `Families get their location email in a few days.`, footer }
    ),
  }
}

// ---------------------------------------------------------------------------
// CX — Class Cancellation (Paid enrollments) · admin confirm · billy@ · T
// Copy deck addendum (July 6). Pronoun-rendered per the Phase 2 pattern;
// dynamic numbering: two offers → 1./2., one offer → unnumbered, none →
// straight-to-refund body. The full-refund option always appears.
// ---------------------------------------------------------------------------

// PL-96: the CX options composer lives in cancellation-copy.ts (a leaf
// module) so the editor SAMPLE can be rendered from the same function —
// composer and sample can never drift silently again. Re-exported here for
// the existing callers.
import { cancellationOptionsHtml, type CancellationOffer } from './cancellation-copy'
import { zonedDeadline } from './dates'
export { zonedDeadline }
export { cancellationOptionsHtml }
export type { CancellationOffer }

export function classCancellationEmail(
  ctx: EnrollmentEmailContext,
  audience: Audience,
  offer: CancellationOffer | null,
  creditTerm: string | null
): Rendered {
  const you = audience === 'student' ? 'you' : ctx.studentFirstName
  const apology = `
      <p>Hi ${recipientFirstName(ctx, audience)},</p>
      <p>Unfortunately, I'm writing with a bit of bad news: we were unable to meet the minimum
      number of students required to offer the ${ctx.className} class that ${you} signed up
      for. As a result, we've unfortunately had to cancel the course. I understand that this
      cancellation can be worrisome, and I sincerely apologize for the inconvenience.</p>`
  const middle = cancellationOptionsHtml(ctx, audience, offer, creditTerm, { convertUrl: convertUrlFor(ctx.enrollmentId), refundUrl: refundRequestUrlFor(ctx.enrollmentId) })

  return {
    from: PERSONAL_FROM,
    subject: `IMPORTANT: ${ctx.className} Course Cancellation`,
    html: wrap(
      `
      ${apology}
      ${middle}
      <p>Best,</p>
      <p>William Thomas<br/>Higher Ground Learning</p>
    `,
      {
        preheader: `The class won't run — here are your options, including a full refund.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// CX-W — Cancellation note (waitlisted families) · admin confirm · info@ · T
// ---------------------------------------------------------------------------

export function waitlistCancellationEmail(ctx: EnrollmentEmailContext): Rendered {
  return {
    subject: `Update on the ${ctx.className} waitlist`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>A quick update: the ${ctx.className} class that ${ctx.studentFirstName} was waitlisted
      for won't be running this term, so the waitlist is closed. No payment was ever taken and
      there's nothing you need to do.</p>
      <p>You're still on our list — the moment a new ${ctx.schoolNickname} ${ctx.classType}
      course opens, you'll be the first to know. Nothing to do on your end.</p>
      <p>Sorry it didn't work out this time!</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `The class won't run this term — no action needed.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// CX-C — Cancellation notification (school contact) · admin confirm · info@ · T
// ---------------------------------------------------------------------------

export function cancellationCounselorEmail(opts: {
  counselorFirst: string
  label: string
  firstSession: string
}): Rendered {
  return {
    subject: `${opts.label} has been cancelled`,
    html: wrap(
      `
      <p>Hi ${opts.counselorFirst},</p>
      <p>A heads-up: the ${opts.label} class scheduled to start
      ${formatDate(opts.firstSession)} didn't reach the minimum enrollment, so we've had to
      cancel it.</p>
      <p>All registered families have already been notified directly with their options
      (including a full refund), so there's nothing you need to do — though if any parents
      mention it, you can let them know to check their email.</p>
      <p>Thanks for your help promoting the class. If there's interest in running it again in a
      future term, we'd love to try — just reply to this email.</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `Families have been notified with their options.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// LOGIN — Portal sign-in link + OTP code · on request · info@ · T
// One email carries both: the link for normal use, the OTP code (length =
// the project's Auth setting, see utils/otp.ts) for expired links and
// school-district link-scanners that consume one-time URLs.
// ---------------------------------------------------------------------------

export function loginLinkEmail(confirmUrl: string, otp: string): Rendered {
  return {
    subject: `Your Higher Ground Learning sign-in link`,
    html: wrap(
      `
      <p>Hi,</p>
      <p>Here's your sign-in link for the Higher Ground Learning portal:</p>
      ${button('Sign in to your portal', confirmUrl)}
      <p>If the button doesn't work (some school networks pre-open links, which can use them up),
      enter this code on the sign-in page instead:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#334155;
      background:#f1f5f9;border-radius:8px;padding:14px 20px;text-align:center">${otp}</p>
      <p>The link and code expire in 1 hour. If you didn't request this email, you can safely
      ignore it — nobody can sign in without it.</p>
      <p>Higher Ground Learning</p>
    `,
      {
        preheader: `Your sign-in link and code are inside.`,
        footer: footerT(),
      }
    ),
  }
}

// ---------------------------------------------------------------------------
// Idempotent send — email_sends is the canonical claim + log (Feature A,
// docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A2). email_log is legacy read-only
// history; its rows were backfilled into email_sends by the A1 migration.
// ---------------------------------------------------------------------------

/**
 * Send an email exactly once per dedupe key, honoring dashboard controls.
 *
 * The dedupe key claims a row in email_sends. A pre-existing row can be:
 *   - already sent (any of SENT_STATUSES/'failed' claim races) → 'duplicate'
 *   - held or cancelled from the comms dashboard          → 'suppressed'
 *   - scheduled with a future time (manually rescheduled) → 'suppressed'
 *   - scheduled & due, or failed (retryable)              → claimed & sent
 * No row → an ad-hoc row is inserted (event-driven sends, alerts, login
 * links), so history is complete either way. On Resend failure a previously
 * scheduled row returns to 'scheduled' (the hourly sweep retries); an ad-hoc
 * row becomes 'failed' (retryable on the next webhook redelivery/cron pass —
 * the claim treats 'failed' as claimable).
 */
export async function sendOnce(opts: {
  dedupeKey: string
  emailType: string
  enrollmentId?: string
  classId?: string
  sessionId?: string
  to: string[]
  cc?: string[]
  from?: string
  /** Feature B3: replies go to the instructor, not the sending identity. */
  replyTo?: string
  subject: string
  html: string
  payload?: Record<string, unknown>
  /** Explicit registry key/role override (defaults derive from emailType). */
  templateKey?: string
  recipientRole?: RecipientRole
  /** Feature B3: composing instructor — drives their self-read RLS. */
  senderEmail?: string
  /** A4 test sends: logged, excluded from stats. */
  isTest?: boolean
  /** A4: which email_template_versions row rendered this body. */
  bodySnapshotId?: string
}): Promise<'sent' | 'duplicate' | 'failed' | 'suppressed'> {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set — skipping email ${opts.dedupeKey}`)
    return 'failed'
  }

  // PL-87: a REAL send may never ship a non-production origin — localhost /
  // 127.x / ngrok / preview deployments all refuse loudly, with an admin
  // alert. ALLOW_REAL_EMAILS deliberately does NOT bypass this: a
  // dev-machine real send is allowed, a dev LINK in a real email never is.
  // (Test-sends are exempt — they go to the admin's own inbox by design.)
  if (!opts.isTest) {
    const badOrigins = nonProductionOrigins(opts.html)
    if (badOrigins.length > 0) {
      console.error(
        `[PL-87] REFUSED real send ${opts.dedupeKey} — non-production origin(s): ${badOrigins.join(', ')}`
      )
      // Quote hosts without a scheme so the alert can't trip its own guard.
      await sendAdminAlert({
        dedupeKey: `origin_guard:${opts.dedupeKey}`,
        adminEmail: process.env.ADMIN_EMAIL ?? 'williamraymondthomas@gmail.com',
        subject: `Blocked: outgoing email carried a non-production link (${opts.templateKey ?? opts.emailType})`,
        body: `<p>A real (non-test) send was <strong>refused</strong> because its body contained
          link origin(s) that aren't production: <strong>${badOrigins.join(', ')}</strong>.</p>
          <p>Send: <code>${opts.dedupeKey}</code> · template ${opts.templateKey ?? opts.emailType}
          · to ${opts.to.join(', ')}.</p>
          <p>This usually means an email was composed on a dev machine from the dev origin.
          Nothing was delivered; the recipient saw nothing. Re-run the send from production
          (or after the compose path is fixed) and it will go out normally.</p>`,
      }).catch((e) => console.error('origin-guard alert failed (send stays refused):', e))
      return 'failed'
    }
  }

  // PL-60: the Roman-Desmond incident. A dev-server cron run against the
  // shared production DB emailed a REAL family — the lifecycle sweep
  // processes every class, not just QA rows — and the links were built from
  // the dev machine's http://localhost base, so every button was dead.
  // Outside production (or whenever the configured link base is localhost)
  // only QA addresses may receive mail; real-recipient sends are suppressed
  // BEFORE any row is claimed, so the production cron still delivers them
  // properly on its next pass. ALLOW_REAL_EMAILS=1 overrides deliberately.
  const linkBase = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const devEnvironment =
    process.env.NODE_ENV !== 'production' || !linkBase || /localhost|127\.0\.0\.1/.test(linkBase)
  if (devEnvironment && process.env.ALLOW_REAL_EMAILS !== '1') {
    const QA_RECIPIENT = /@highergroundlearning\.com$|@example\.(com|org|net)$/i
    const real = [...opts.to, ...(opts.cc ?? [])].filter((a) => !QA_RECIPIENT.test(a.trim()))
    if (real.length > 0) {
      console.error(
        `[PL-60] suppressed non-QA send from dev environment: ${opts.dedupeKey} → ${real.join(', ')}`
      )
      return 'suppressed'
    }
  }

  // PL-60: no email leaves with a dead primary action. Empty, "#", relative,
  // or unresolved-{variable} hrefs are exactly how the incident presented
  // (a Gmail button that anchors to the message itself). Loud in production
  // (the send still beats silence for transactional mail); fatal in dev so
  // E2E runs catch it.
  const badHrefs = [...opts.html.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((h) => {
      const raw = h.replace(/&amp;/g, '&').trim()
      return raw === '' || raw === '#' || raw.includes('{') || !/^(https?:|mailto:|tel:)/i.test(raw)
    })
  if (badHrefs.length > 0) {
    console.error(
      `[PL-60] dead link(s) in ${opts.dedupeKey}: ${badHrefs.map((h) => JSON.stringify(h)).join(', ')}`
    )
    if (devEnvironment) return 'failed'
  }

  const meta = templateMetaFor(opts.emailType, opts.dedupeKey)
  const nowIso = new Date().toISOString()

  const { data: existing } = await supabase
    .from('email_sends')
    .select('id, status, scheduled_for')
    .eq('dedupe_key', opts.dedupeKey)
    .maybeSingle()

  let rowId: string
  let wasScheduled = false
  if (existing) {
    if (existing.status === 'held' || existing.status === 'cancelled') return 'suppressed'
    if (existing.status === 'scheduled' && existing.scheduled_for > nowIso) return 'suppressed'
    if (existing.status !== 'scheduled' && existing.status !== 'failed') return 'duplicate'
    // Claim: conditional transition to 'sending'. A concurrent run loses.
    const { data: claimed } = await supabase
      .from('email_sends')
      .update({ status: 'sending', updated_at: nowIso })
      .eq('id', existing.id)
      .in('status', ['scheduled', 'failed'])
      .select('id')
    if (!claimed || claimed.length === 0) return 'duplicate'
    rowId = existing.id
    wasScheduled = existing.status === 'scheduled'
  } else {
    const { data: inserted, error: claimError } = await supabase
      .from('email_sends')
      .insert([
        {
          dedupe_key: opts.dedupeKey,
          template_key: opts.templateKey ?? meta.key,
          enrollment_id: opts.enrollmentId ?? null,
          class_id: opts.classId ?? null,
          recipient_email: opts.to[0]?.toLowerCase() ?? 'unknown@invalid',
          recipient_role: opts.recipientRole ?? meta.role,
          sender_email: opts.senderEmail ?? null,
          cc: opts.cc ?? null,
          scheduled_for: nowIso,
          status: 'sending',
          payload: opts.payload ?? null,
          is_test: opts.isTest ?? false,
          body_snapshot_id: opts.bodySnapshotId ?? null,
        },
      ])
      .select('id')
    if (claimError || !inserted || inserted.length === 0) {
      if (claimError?.code === '23505') return 'duplicate'
      console.error(`email_sends claim failed for ${opts.dedupeKey}:`, claimError?.message)
      return 'failed'
    }
    rowId = inserted[0].id
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data: sendData, error: sendError } = await resend.emails.send({
    from: opts.from ?? FROM,
    to: opts.to,
    cc: opts.cc,
    replyTo: opts.replyTo,
    subject: opts.subject,
    html: opts.html,
  })

  if (sendError) {
    console.error(`Resend send failed for ${opts.dedupeKey}:`, sendError.message)
    await supabase
      .from('email_sends')
      .update({ status: wasScheduled ? 'scheduled' : 'failed', updated_at: new Date().toISOString() })
      .eq('id', rowId)
    return 'failed'
  }

  await supabase
    .from('email_sends')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      resend_email_id: sendData?.id ?? null,
      subject_rendered: opts.subject,
      ...(opts.bodySnapshotId ? { body_snapshot_id: opts.bodySnapshotId } : {}),
      ...(opts.payload ? { payload: opts.payload } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)

  return 'sent'
}

/** Admin notification. Dedupe key still applies (e.g. one alert per class per day). */
/**
 * Registration notification (ADMIN email, July 8 punch list): fires once per
 * PAID registration from the Stripe webhook — replaces the old Squarespace
 * notification. Strictly separate from the Phase 4 counselor digest. The
 * running counts ride in the subject so the inbox list alone reads as a
 * ticker. Recipient: REGISTRATION_NOTIFY_EMAIL (billy@ during testing).
 */
export function registrationNotificationContent(opts: {
  studentName: string
  label: string // "{nickname} {classType}"
  schoolName: string
  addonNames: string[] // in-checkout tutoring add-ons, [] when none
  paid: number
  pending: number
  minEnrollment: number
  capacity: number
}): { subject: string; body: string } {
  // PL-57: a registration only exists because payment completed — "paid" is
  // noise. Pending rides the count as "3 + 1 pending" only when present.
  // PL-73: label the first number — "(1 / 8 min / 10 cap)" read as a puzzle.
  const taken =
    opts.pending > 0
      ? `${opts.paid} enrolled + ${opts.pending} pending`
      : `${opts.paid} enrolled`
  const counts = `${taken} / ${opts.minEnrollment} min / ${opts.capacity} cap`
  return {
    subject: `New registration: ${opts.studentName} — ${opts.label} (${counts})`,
    body: `
      <p><strong>${opts.studentName}</strong> registered for <strong>${opts.label}</strong>
      (${opts.schoolName}).</p>
      ${
        opts.addonNames.length > 0
          ? `<p>Add-on purchased: <strong>${opts.addonNames.join(', ')}</strong></p>`
          : ''
      }
      <p>${opts.label}: <strong>${counts}</strong></p>`,
  }
}

export async function sendAdminAlert(opts: {
  dedupeKey: string
  adminEmail: string
  subject: string
  body: string
  enrollmentId?: string
  /** PL-66: the alert's registry template (AL_*). When set AND the template
   *  is live, the editable framing (subject/body) comes from the registry
   *  with the composed guts riding {alertDetailsBlock}; until then the
   *  passed subject/body send exactly as before. */
  templateKey?: string
  /** PL-66: scalar variables the template's subject/body may use
   *  ({alertStudentName}, {alertCounts}, …) plus any stub overrides. */
  vars?: import('./comms-variables').ExtraVars & {
    schoolNickname?: string
    classType?: string
    schoolName?: string
    studentFirstName?: string
    firstSession?: string
  }
}) {
  // Code twin: exactly the pre-PL-66 render.
  const fallback = (): Rendered => ({
    subject: opts.subject,
    html: wrap(`<h2 style="color:#334155">${opts.subject}</h2>${opts.body}`, {
      preheader: opts.subject,
      footer: footerT(),
    }),
  })

  let rendered: Rendered = fallback()
  if (opts.templateKey) {
    try {
      // Dynamic import: comms-registered depends on this module — resolving
      // at call time keeps the cycle harmless.
      const { renderRegistered } = await import('./comms-registered')
      const { schoolNickname, classType, schoolName, studentFirstName, firstSession, ...extra } =
        opts.vars ?? {}
      rendered = await renderRegistered(
        opts.templateKey,
        {
          parentFirstName: 'Ops Director',
          parentEmail: opts.adminEmail,
          schoolNickname,
          classType,
          schoolName,
          firstSession,
          ...(studentFirstName ? { studentFirstName } : {}),
        },
        { alertDetailsBlock: opts.body, ...extra },
        fallback
      )
    } catch (e) {
      console.error(`alert template render failed for ${opts.templateKey} — code copy sent:`, e)
      rendered = fallback()
    }
  }

  return sendOnce({
    dedupeKey: opts.dedupeKey,
    emailType: 'admin_alert',
    templateKey: opts.templateKey,
    recipientRole: 'admin',
    enrollmentId: opts.enrollmentId,
    to: [opts.adminEmail],
    subject: `[HGL Admin] ${rendered.subject}`,
    html: rendered.html,
  })
}
