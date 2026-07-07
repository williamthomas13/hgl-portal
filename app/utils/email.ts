import { Resend } from 'resend'
import { supabaseAdmin as supabase } from "./supabase-admin"
import { packageSavings, type AddonRow, type TutoringPackage } from './lifecycle'

// Server-side only. Every send goes through sendOnce(), which claims a row in
// email_log first — Stripe webhook retries and cron re-runs never double-send.
//
// COPY: final copy from docs/EMAIL_COPY.md (v1.0). Template variables map to
// EnrollmentEmailContext fields; pronoun-conditional templates take an
// `audience` argument and render third person for the parent send, second
// person for the student send. Footer types per the deck: T = transactional
// (no unsubscribe), R = relationship (marketing opt-out link).

const FROM = process.env.EMAIL_FROM ?? 'Higher Ground Learning <onboarding@resend.dev>'

// Personal sender for #1, #7, #8, #9 (and the combined welcome, which
// carries #1). Deck: "William Thomas <billy@highergroundlearning.com>".
const PERSONAL_FROM =
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
  parentFirstName: string
  parentEmail: string
  studentFirstName: string
  studentLastName: string
  studentEmail: string | null
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
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
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
function footerT(customText?: string) {
  return `${customText ? `<p style="font-size:13px;color:#64748b">${customText}</p>` : ''}
    <p style="font-size:13px;color:#64748b">Higher Ground Learning · highergroundlearning.com ·
    questions? Just reply to this email.</p>`
}

function footerR(unsubscribeUrl: string, customText?: string) {
  return `${customText ? `<p style="font-size:13px;color:#64748b">${customText}</p>` : ''}
    <p style="font-size:13px;color:#64748b">Higher Ground Learning · highergroundlearning.com ·
    <a href="${unsubscribeUrl}" style="color:#64748b">Unsubscribe from non-essential updates</a></p>`
}

type WrapOpts = {
  /** Hidden preview-text line shown next to the subject in inbox lists. */
  preheader: string
  footer: string
}

function wrap(body: string, opts: WrapOpts) {
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

// ---------------------------------------------------------------------------
// #0-P — Registration Confirmation (parent) · instant · info@ · T
// ---------------------------------------------------------------------------

export function parentConfirmationEmail(ctx: EnrollmentEmailContext): Rendered {
  const addonLines = ctx.addons
    .map((a) => `<br/>${a.name} — 1-on-1 Tutoring — $${a.pricePaid}`)
    .join('')
  const detail = (label: string, value: string | null) =>
    `<br/><strong>${label}:</strong> ${value && value.trim() ? value : '—'}`
  return {
    subject: `Order Confirmed — ${ctx.className}`,
    html: wrap(
      `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>Thanks for registering! Your class registration with Higher Ground Learning is confirmed.</p>
      <p>We'll be in touch with you in the days before the first day of class with all the relevant
      information that you'll need! This includes diagnostic test information, instructor information,
      and course room location (for both in-person and online classes).</p>
      <p><em>Did you register for 1-on-1 tutoring?</em> The 1-on-1 tutoring sessions are best used
      after the group class is completed. We'll be in touch with you after the course is done in
      order to schedule these sessions. If you'd like to schedule them now, that's okay too; just
      reply to this email with some general time frames when you're available so that we can
      propose a schedule.</p>
      <p>If you have any questions between now and then, you can respond to this email (but maybe
      check our <a href="https://highergroundlearning.com/faqs#general">FAQs</a> first).</p>
      <h3 style="color:#334155">Order Summary</h3>
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
      such as classroom location and information to access your initial diagnostic test.</p>
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
  // Expiry = 7 days after registration (PAYMENT_EXPIRY_HOURS).
  const expiry = new Date(new Date(ctx.enrolledAt).getTime() + 168 * 3_600_000)
  const expiryDate = expiry.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const preheader =
    n === 4
      ? `After ${expiryDate}, the spot returns to the pool.`
      : 'Complete your payment to save their place in class'

  const bodies: Record<number, string> = {
    1: `
      <p>Hi ${ctx.parentFirstName},</p>
      <p>We saw that you filled out the registration form for ${ctx.studentFirstName} for the
      ${ctx.className} class but didn't proceed to complete payment and confirm their registration.
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
      ${s} for our class you've given them one less thing to worry about.</p>
      <p>I know that, personally, I never would have even gone to university if it weren't for one
      person...</p>
      <p>My amazing mom.</p>
      <p>I certainly wouldn't have gone on to earn a Master's degree and definitely wouldn't be
      here right now, writing you this email.</p>
      <p>We don't take lightly the chance to work with ${s} and to help them achieve their best
      score on the test. And we really appreciate your vote of confidence in us.</p>
      <p>So here's what happens next.</p>
      <p>In the days before the course starts, you and ${s} will receive the necessary course
      information, such as classroom location and diagnostic test access.</p>
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
      <p><strong>I didn't receive the diagnostic test link or information. What should I do?</strong><br/>
      Actually we emailed this information to you very recently. Search your inbox and spam folders
      for an email titled "Important diagnostic test information."</p>
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
      here: ${classroomHtml(ctx)}</strong>.</p>
      <p>We're looking forward to seeing ${isStudent ? 'you' : s} in class!</p>
      <p>All the best,</p>
      <p>Higher Ground Learning</p>
      <p>P.S. If ${isStudent ? "you haven't" : `${s} hasn't`} found a moment to take the diagnostic
      test yet, ${isStudent ? 'you' : 'they'} can still do so by clicking below. If
      ${isStudent ? 'you have' : 'they have'} already completed the test, no need to let us know.
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

export function locationReminderEmail(ctx: EnrollmentEmailContext, audience: Audience): Rendered {
  const isStudent = audience === 'student'
  const s = ctx.studentFirstName
  const synap = synapUrl(ctx)
  return {
    subject: `Classroom location for ${ctx.className}`,
    html: wrap(
      `
      <h2 style="color:#334155">Class starts soon!</h2>
      <p><em>Like, really soon.</em></p>
      <p>Hey ${recipientFirstName(ctx, audience)},</p>
      <p>Sorry for so many messages, but we really wanted to make sure that
      ${isStudent ? "you don't" : `${s} doesn't`} miss the first day of ${ctx.className}!</p>
      <p>So here you go...one last reminder: the first day of class is
      ${formatDate(ctx.firstSession)} from ${classTimeHtml(ctx)}.</p>
      <p><strong>All classes take place here: ${classroomHtml(ctx)}</strong></p>
      <p>Looking forward to seeing ${isStudent ? 'you' : s} in class!</p>
      <p>P.S. If ${isStudent ? "you still haven't" : `${s} still hasn't`} taken the first
      diagnostic test, don't worry. It's still available
      ${synap ? `<a href="${synap}">here</a>` : `via the link in your diagnostic test email`}.</p>
    `,
      {
        preheader: `Open up to see where to go for class.`,
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
      <p>I sincerely hope that ${isStudent ? 'you have' : `${s} has`} been taking advantage of
      ${isStudent ? 'your' : 'their'} class time with ${ctx.instructorName ?? 'the instructor'} to
      the fullest.</p>
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
      confident and ready to do their best on the exam!</p>
      <p>Congrats to ${s} for their hard work and commitment to improvement.</p>
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
      <p>The idea behind our classes is that ${s} should now have the tools they need to be
      successful on the test. Of course, we know that some students will continue to study and
      refine their skills for a future test.</p>
      <p>With that in mind, we offer students who have completed one of our classes discounted
      1-on-1 tutoring hours. We don't expect that this option is appropriate for all students, but
      we provide it as a service in case ${s} wants to continue studying with us.</p>
      <p><strong>You can access discounted tutoring at
      <a href="${DISCOUNT_URL}">highergroundprep.com/discount</a> by using the password
      BESTSCORE.</strong></p>
      <p>If you sign up, we'll get input from ${instructor} to make sure that ${s}'s transition
      from the class to live online tutoring is seamless and they don't lose any momentum with
      their test prep before the real test.</p>
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
  expiresAt: string
): Rendered {
  const s = ctx.studentFirstName
  const deadline = new Date(expiresAt).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
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
      <p>If your plans have changed and you no longer need the spot, no action needed — it'll pass
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
      ? `The instructor will be ${ctx.instructorName}, and classes take place at ${classroomHtml(ctx)}.`
      : `We'll send classroom and instructor details as soon as they're confirmed.`

  const addonLines = ctx.addons
    .map((a) => `<br/>${a.name} — 1-on-1 Tutoring — $${a.pricePaid}`)
    .join('')
  const detail = (label: string, value: string | null) =>
    `<br/><strong>${label}:</strong> ${value && value.trim() ? value : '—'}`
  const orderSummary = isStudent
    ? ''
    : `
      <h3 style="color:#334155">Order Summary</h3>
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
      <p>To get in: click below, hit "register," and provide some quick basic info.</p>
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
}

export function counselorDigestEmail(opts: {
  counselorFirst: string
  schoolName: string
  schoolNickname: string
  classes: DigestClassInfo[]
  frequencyUrls: { weekly: string; biweekly: string; monthly: string; paused: string }
}): Rendered {
  // {classListBlock}: one block per class; single-class schools render one.
  const classListBlock = opts.classes
    .map(
      (c) => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:10px 0">
        <p style="margin:0 0 4px"><strong>${c.classType} — starts ${formatDate(c.firstSession)}</strong></p>
        <p style="margin:0;color:#475569">Enrolled: <strong>${c.paid} of ${c.capacity}</strong>
        (${c.newSinceLast} new since last update) · Waitlist: ${c.waitlistDepth}</p>
        <p style="margin:6px 0 0;font-size:13px">Registration link to share:
        <a href="${c.regUrl}">${c.regUrl}</a></p>
      </div>`
    )
    .join('')
  // Subject count: the class's count for single-class schools; multi-class
  // schools say "2 classes, 17 students" so the total can't read as one
  // class's headcount.
  const totalPaid = opts.classes.reduce((sum, c) => sum + c.paid, 0)
  const nClasses = opts.classes.length
  const subjectCount =
    nClasses === 1
      ? `${totalPaid} student${plS(totalPaid)} enrolled`
      : `${nClasses} class${plEs(nClasses)}, ${totalPaid} student${plS(totalPaid)} enrolled`
  const f = opts.frequencyUrls
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
        footer: `<p style="font-size:13px;color:#64748b">How often do you want these?
          <a href="${f.weekly}" style="color:#64748b">Weekly</a> ·
          <a href="${f.biweekly}" style="color:#64748b">Every 2 weeks</a> ·
          <a href="${f.monthly}" style="color:#64748b">Monthly</a> ·
          <a href="${f.paused}" style="color:#64748b">Pause</a></p>
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

// Offer math uses classes.price ONLY — the cancelled product is the group
// class. Tutoring add-ons are a separate purchase that SURVIVES cancellation
// in every outcome (including refund: refund = class fee only), so add-on
// amounts never appear in the math or the refund language. Identical for
// every family; only the CX *variant* differs (add-on families get the
// combined-total wording + the keep-your-hours line).
export type CancellationOffer = {
  hours: number
  /** The class fee (classes.price) — never amount_paid. */
  price: number
  savingsPct: number
  savingsUsd: number
}

export function classCancellationEmail(
  ctx: EnrollmentEmailContext,
  audience: Audience,
  offer: CancellationOffer | null,
  creditTerm: string | null
): Rendered {
  const isStudent = audience === 'student'
  const s = ctx.studentFirstName
  const you = isStudent ? 'you' : s
  // Add-on variant switch: hours this family already purchased.
  const addonHours = ctx.addons.reduce((sum, a) => sum + a.hours, 0)

  const blocks: string[] = []
  if (offer) {
    const totalHours = offer.hours + addonHours
    // DRAFT WORDING (add-on variant): combined-total sentence pending the
    // exact copy from the deck addendum — swap verbatim when it lands.
    const receives =
      addonHours > 0
        ? `This means ${you} would receive ${offer.hours} hours of 1-on-1 tutoring for
          $${offer.price.toLocaleString()} — which, together with the ${addonHours} tutoring
          hours ${isStudent ? 'your family' : 'you'} already purchased, comes to
          <strong>${totalHours} hours of 1-on-1 tutoring in total</strong> — enough time to`
        : `This means ${you} would receive ${offer.hours} hours of 1-on-1 tutoring for
          $${offer.price.toLocaleString()}, which is enough time to`
    blocks.push(
      `<strong>We can convert the course fee that you have already paid into ${offer.hours}
      1-on-1 tutoring hours — a savings of over ${offer.savingsPct}%
      (USD $${offer.savingsUsd.toLocaleString()}) from our typical fees</strong> as our apology
      that we weren't able to offer the group course. ${receives}
      cover a lot of material and strategy and see a meaningful improvement. We
      would tailor the schedule to ${isStudent ? 'your' : "your family's"} availability and the
      lesson content to ${isStudent ? 'your' : `${s}'s`} strengths and weaknesses (according to
      the first diagnostic test score).`
    )
  }
  if (creditTerm) {
    blocks.push(
      `<strong>We can apply the fee that you paid to our next ${ctx.classType} course at
      ${ctx.schoolNickname}.</strong> That course will most likely be offered in ${creditTerm}.`
    )
  }

  const apology = `
      <p>Hi ${recipientFirstName(ctx, audience)},</p>
      <p>Unfortunately, I'm writing with a bit of bad news: we were unable to meet the minimum
      number of students required to offer the ${ctx.className} class that ${you} signed up
      for. As a result, we've unfortunately had to cancel the course. I understand that this
      cancellation can be worrisome, and I sincerely apologize for the inconvenience.</p>`

  // DRAFT WORDING (add-on variant): keep-your-hours reassurance pending the
  // exact copy from the deck addendum — swap verbatim when it lands. Renders
  // after the options list (and in the refund-only body) for add-on families:
  // add-on hours survive every outcome, including a refund of the class fee.
  const keepHours =
    addonHours > 0
      ? `<p>And whichever option you choose — including the refund — the ${addonHours} 1-on-1
        tutoring hour${plS(addonHours)} you purchased with registration ${isAre(addonHours)}
        yours to keep and completely unaffected.</p>`
      : ''
  const keepHoursRefundOnly =
    addonHours > 0
      ? `<p>And to be clear: the refund covers the class fee — the ${addonHours} 1-on-1
        tutoring hour${plS(addonHours)} you purchased with registration ${isAre(addonHours)}
        yours to keep and completely unaffected.</p>`
      : ''

  let middle: string
  if (blocks.length === 0) {
    middle = `
      <p>We'll be issuing you a full refund — just reply to confirm the best way to reach you
      if any details are needed, and please accept our apologies again.</p>
      ${keepHoursRefundOnly}`
  } else {
    const rendered =
      blocks.length === 1
        ? `<p>${blocks[0]}</p>`
        : `<ol style="padding-left:20px">${blocks.map((b) => `<li style="margin-bottom:12px">${b}</li>`).join('')}</ol>`
    middle = `
      <p>However, I have a couple of other options for you:</p>
      ${rendered}
      <p>If you prefer, of course we can also offer you a <strong>full refund</strong> instead.
      <strong>Please let me know your preference by replying to this email — and reach out with
      any questions at all.</strong></p>
      ${keepHours}`
  }

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
      <p>If the class is offered again at ${ctx.schoolNickname}, registration will open through
      the school as usual — and if you'd like a heads-up when that happens, just reply to this
      email and we'll make sure you hear first.</p>
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
// Idempotent send
// ---------------------------------------------------------------------------

/**
 * Send an email exactly once per dedupe key.
 * Claims the email_log row first; if the claim conflicts, someone already
 * sent it. If the actual send fails, the claim is released so a retry
 * (webhook redelivery / next cron run) can try again.
 */
export async function sendOnce(opts: {
  dedupeKey: string
  emailType: string
  enrollmentId?: string
  sessionId?: string
  to: string[]
  cc?: string[]
  from?: string
  subject: string
  html: string
  payload?: Record<string, unknown>
}): Promise<'sent' | 'duplicate' | 'failed'> {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set — skipping email ${opts.dedupeKey}`)
    return 'failed'
  }

  const { error: claimError } = await supabase.from('email_log').insert([
    {
      dedupe_key: opts.dedupeKey,
      email_type: opts.emailType,
      enrollment_id: opts.enrollmentId ?? null,
      session_id: opts.sessionId ?? null,
      recipients: opts.to,
      payload: opts.payload ?? null,
    },
  ])

  if (claimError) {
    if (claimError.code === '23505') return 'duplicate' // unique violation: already sent
    console.error(`email_log claim failed for ${opts.dedupeKey}:`, claimError.message)
    return 'failed'
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error: sendError } = await resend.emails.send({
    from: opts.from ?? FROM,
    to: opts.to,
    cc: opts.cc,
    subject: opts.subject,
    html: opts.html,
  })

  if (sendError) {
    console.error(`Resend send failed for ${opts.dedupeKey}:`, sendError.message)
    await supabase.from('email_log').delete().eq('dedupe_key', opts.dedupeKey)
    return 'failed'
  }

  return 'sent'
}

/** Admin notification. Dedupe key still applies (e.g. one alert per class per day). */
export async function sendAdminAlert(opts: {
  dedupeKey: string
  adminEmail: string
  subject: string
  body: string
  enrollmentId?: string
}) {
  return sendOnce({
    dedupeKey: opts.dedupeKey,
    emailType: 'admin_alert',
    enrollmentId: opts.enrollmentId,
    to: [opts.adminEmail],
    subject: `[HGL Admin] ${opts.subject}`,
    html: wrap(`<h2 style="color:#334155">${opts.subject}</h2>${opts.body}`, {
      preheader: opts.subject,
      footer: footerT(),
    }),
  })
}
