import type { Audience, EnrollmentEmailContext } from './email'

// PL-96: extracted from email.ts into a LEAF module so comms-variables can
// render the editor sample FROM this composer (drift-proof by construction).
// The ctx param is a structural Pick — real sends pass the full context.
// GENUINELY leaf (PL-96 follow-up): comms-variables rides in the templates
// page's CLIENT bundle, so this module may import nothing that reaches
// server-only code — the convert URL is therefore a REQUIRED caller input
// (server callers mint it with convertUrlFor; the sample passes the test
// link), never computed here.

export type CancellationCtx = Pick<
  EnrollmentEmailContext,
  'enrollmentId' | 'studentFirstName' | 'addons' | 'classType' | 'schoolNickname' | 'className'
>

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

/** The CX middle — options list / refund line / keep-your-hours note. Also
 *  passed to the registry render as {cancellationOptionsBlock} (PL-13), so
 *  the editable template and the code twin share one source of truth for
 *  the conditional math. */
export function cancellationOptionsHtml(
  ctx: CancellationCtx,
  audience: Audience,
  offer: CancellationOffer | null,
  creditTerm: string | null,
  /** REQUIRED: server callers mint the real /convert link (convertUrlFor);
   *  the editor sample passes the test link. Caller-supplied so this module
   *  stays client-safe (no lifecycle/crypto/secret imports). */
  opts: { convertUrl: string }
): string {
  const isStudent = audience === 'student'
  const s = ctx.studentFirstName
  const you = isStudent ? 'you' : s
  // Add-on variant switch: hours this family already purchased.
  const addonHours = ctx.addons.reduce((sum, a) => sum + a.hours, 0)

  const blocks: string[] = []
  if (offer) {
    const totalHours = offer.hours + addonHours
    const classPrice = `$${offer.price.toLocaleString()}`
    // Deck addendum verbatim — standard vs add-on version of item 1.
    const receives =
      addonHours > 0
        ? `With ${isStudent ? 'your' : 'the'} ${addonHours} discounted tutoring hours already
          purchased, ${you} would receive a total of ${totalHours} hours of 1-on-1 tutoring,
          which would be enough time to cover a lot of material and strategy and see a very
          meaningful improvement.`
        : `This means ${you} would receive ${offer.hours} hours of 1-on-1 tutoring for
          ${classPrice}, which is enough time to cover a lot of material and strategy and see
          a meaningful improvement.`
    blocks.push(
      `<strong>We can convert the group course fee of ${classPrice} that you have already paid
      into ${offer.hours} 1-on-1 tutoring hours — a savings of over ${offer.savingsPct}%
      (USD $${offer.savingsUsd.toLocaleString()}) from our typical fees</strong> as our apology
      that we weren't able to offer the group course. ${receives} We
      would tailor the schedule to ${isStudent ? 'your' : "your family's"} availability and the
      lesson content to ${isStudent ? 'your' : `${s}'s`} strengths and weaknesses (according to
      the first diagnostic test score).
      <span style="display:block;margin:14px 0"><a href="${opts.convertUrl}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Convert my ${ctx.className} payment to ${offer.hours} hours of 1-on-1 tutoring</a></span>
      <span style="color:#64748b;font-size:13px">One tap to confirm on the next page — then pick the
      times that work. Prefer to talk it through first? Just reply.</span>`
    )
  }
  if (creditTerm) {
    blocks.push(
      `<strong>We can apply the fee that you paid to our next ${ctx.classType} course at
      ${ctx.schoolNickname}.</strong> That course will most likely be offered in ${creditTerm}.`
    )
  }

  // Deck addendum verbatim: add-on families get this reassurance immediately
  // after the options list, regardless of which offers are on — the line is
  // written to hold for the refund-only body too.
  const keepHours =
    addonHours > 0
      ? `<p>(And just to be clear: the ${addonHours} discounted 1-on-1 tutoring hours you
        already purchased are ${isStudent ? 'yours' : `${s}'s`} to keep no matter which option
        you choose — including a refund of the course fee.)</p>`
      : ''

  if (blocks.length === 0) {
    return `
      <p>We'll be issuing you a full refund — just reply to confirm the best way to reach you
      if any details are needed, and please accept our apologies again.</p>
      ${keepHours}`
  }
  const rendered =
    blocks.length === 1
      ? `<p>${blocks[0]}</p>`
      : `<ol style="padding-left:20px">${blocks.map((b) => `<li style="margin-bottom:12px">${b}</li>`).join('')}</ol>`
  return `
      <p>However, I have a couple of other options for you:</p>
      ${rendered}
      <p>If you prefer, of course we can also offer you a <strong>full refund</strong> instead.
      <strong>Please let me know your preference by replying to this email — and reach out with
      any questions at all.</strong></p>
      ${keepHours}`
}

