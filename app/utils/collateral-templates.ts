import {
  classTime,
  dayMonth,
  dayPattern,
  escapeHtml as esc,
  flyerDateRange,
  letterDateRange,
  monthYearLabel,
  type CollateralLanguage,
  type CollateralModel,
} from './collateral'
import { flyerIntroDefault } from './collateral-shared'

// Phase 4.5 templates: A4 HTML/CSS rendered by headless Chromium. All copy is
// deck-verbatim (docs/hgl-phase4.5-collateral-copy.md) — do not reword here.
// Layout mirrors the approved examples in docs/collateral-examples/ using
// fixed mm geometry so PDF and JPG output are pixel-stable.

/** Repo-static art, pre-inlined as data URLs (see loadStaticAssets — CSS mask
 *  images are CORS-fetched, so nothing here may be a network URL). */
export type StaticAssets = {
  brushMask: string
  logoWhite: string
  logoColor: string
  hero: string
  fonts: { weight: number; dataUrl: string }[]
}

export type TemplateAssets = StaticAssets & {
  /** QR code for registerUrl, as a data URL (transparent background). */
  qrDataUrl: string
  /** Signature image data URL — null renders the typed name alone. */
  signatureDataUrl: string | null
}

const SLATE = '#506171'
const BLUE = '#00AEEE'
const INK = '#16323f' // dark navy of the letterhead angles
const BOX_BLUE = '#c9ecfb' // letter summary box

function fontFace(assets: TemplateAssets): string {
  return assets.fonts
    .map(
      (f) => `
    @font-face {
      font-family: 'Poppins'; font-style: normal; font-weight: ${f.weight};
      src: url('${f.dataUrl}') format('truetype');
    }`
    )
    .join('\n')
}

function pageShell(css: string, body: string, assets: TemplateAssets, lang: CollateralLanguage): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
${fontFace(assets)}
@page { size: A4; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 210mm; height: 297mm; }
body { font-family: 'Poppins', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #fff; }
${css}
</style></head>
<body><div class="page ${lang}">${body}</div></body></html>`
}

/** Long variable text (promo codes, custom class types) steps the font size
 *  down instead of overflowing: full size up to `comfortable` characters,
 *  then proportional shrink, floored at 65%. */
function stepPt(base: number, len: number, comfortable: number): number {
  if (len <= comfortable) return base
  return Math.max((base * comfortable) / len, base * 0.65)
}

/** Accent-tinted brush circle (the burst / CTA element): the brush-ring PNG's
 *  alpha becomes a CSS mask so one asset serves every school color. */
function brush(mask: string, color: string, extra = ''): string {
  return `position:absolute; background:${color};
    -webkit-mask-image:url('${mask}'); -webkit-mask-size:100% 100%; -webkit-mask-repeat:no-repeat;
    mask-image:url('${mask}'); mask-size:100% 100%; mask-repeat:no-repeat; ${extra}`
}

// ---------------------------------------------------------------------------
// Student flyer (copy deck F-EN / F-ES)
// ---------------------------------------------------------------------------

const FLYER_COPY = {
  en: {
    qrCaption: 'Scan to register',
    seeDays: (link: string) => `(VISIT ${link} TO SEE CLASS DAYS)`,
    promo: (amount: string, deadline: string, code: string) => {
      const small = `SIGN UP BEFORE ${deadline.toUpperCase()} & USE CODE "${code}"`
      return `<div class="burst-big" style="font-size:${stepPt(30, `SAVE ${amount}`.length, 9)}pt;">SAVE ${esc(amount)}</div>
       <div class="burst-small" style="font-size:${stepPt(12.5, small.length, 44)}pt;">SIGN UP BEFORE ${esc(deadline).toUpperCase()} &amp; USE CODE &ldquo;${esc(code)}&rdquo;</div>`
    },
    deadline: (date: string) =>
      `<div class="burst-small" style="font-size:17pt; line-height:1.2;">REGISTRATION CLOSES ${esc(date).toUpperCase()}</div>
       <div class="burst-small" style="font-size:14pt; margin-top:2.5mm;">SAVE YOUR SPOT!</div>`,
    bullets: (m: CollateralModel) => [
      `${m.inPerson ? 'In-person' : 'Live online'} instruction from expert instructors`,
      `${m.practiceTestCount} full-length tests`,
      'Content, strategy, tactics, &amp; timing',
      'Comprehensive curriculum',
    ],
    cta: 'Spaces are limited! More info, FAQs, and registration:',
  },
  es: {
    qrCaption: 'Escanea para inscribirte',
    seeDays: (link: string) => `(VISITA ${link} PARA VER LOS DÍAS DE CLASE)`,
    promo: (amount: string, deadline: string, code: string) => {
      const small = `INSCRÍBETE ANTES DEL ${deadline.toUpperCase()} CON EL CÓDIGO "${code}"`
      return `<div class="burst-big" style="font-size:${stepPt(28, `AHORRA ${amount}`.length, 11)}pt;">AHORRA ${esc(amount)}</div>
       <div class="burst-small" style="font-size:${stepPt(12, small.length, 48)}pt;">INSCRÍBETE ANTES DEL ${esc(deadline).toUpperCase()} CON EL CÓDIGO &ldquo;${esc(code)}&rdquo;</div>`
    },
    deadline: (date: string) =>
      `<div class="burst-small" style="font-size:15.5pt; line-height:1.2;">INSCRIPCIONES HASTA EL ${esc(date).toUpperCase()}</div>
       <div class="burst-small" style="font-size:13.5pt; margin-top:2.5mm;">¡APARTA TU LUGAR!</div>`,
    bullets: (m: CollateralModel) => [
      `Instrucción ${m.inPerson ? 'presencial' : 'en línea y en vivo'} con instructores expertos`,
      `${m.practiceTestCount} exámenes completos de práctica`,
      'Contenido, estrategia, tácticas y manejo del tiempo',
      'Plan de estudios integral',
    ],
    cta: '¡Los lugares son limitados! Más información, preguntas frecuentes e inscripción:',
  },
}

function flyerIntro(m: CollateralModel, lang: CollateralLanguage): string {
  if (m.flyerBlurb) return esc(m.flyerBlurb)
  // Single source of truth with the admin card's placeholder default.
  return esc(
    flyerIntroDefault({
      schoolNickname: m.schoolNickname,
      classType: m.classType,
      inPerson: m.inPerson,
      sessionDates: m.sessions.map((s) => s.session_date),
      lang,
    })
  )
}

export function flyerHtml(m: CollateralModel, lang: CollateralLanguage, assets: TemplateAssets): string {
  const t = FLYER_COPY[lang]
  const accent = m.accentColor
  const headline =
    lang === 'es'
      ? `CURSO DE<br>PREPARACIÓN<br>${esc(m.examName)}`
      : `${esc(m.classType).toUpperCase().replace(/ PREP$/, ' PREP')}<br>COURSE`
  // Custom class types can outgrow the column left of the QR — shrink the
  // headline instead of wrapping mid-word.
  const headlinePt =
    lang === 'es'
      ? stepPt(32, Math.max(m.examName.length, 11), 11)
      : stepPt(47, Math.max(m.classType.length, 6), 9)
  const days = dayPattern(m, lang)
  const time = classTime(m, '|')

  // Burst priority (spec §4): promo → enrollment deadline → collapse.
  let burst = ''
  if (m.promo) {
    burst = t.promo(m.promo.amount, dayMonth(m.promo.deadline, lang), m.promo.code)
  } else if (m.enrollmentDeadline) {
    burst = t.deadline(dayMonth(m.enrollmentDeadline, lang))
  }

  const css = `
  .band { position:absolute; z-index:0; }
  .hero { position:absolute; right:0; bottom:0; width:106mm; height:134mm;
    object-fit:cover; border-radius:16mm 0 0 0; z-index:1; }
  .hgl-logo { position:absolute; left:13mm; top:8mm; width:46mm; z-index:2; }
  .school-logo-wrap { position:absolute; right:5mm; top:3mm; width:62mm; height:38mm;
    display:flex; align-items:center; justify-content:center; z-index:2; }
  .school-logo-wrap img { max-width:100%; max-height:100%; }
  .headline { position:absolute; left:13mm; top:44mm; z-index:2; color:${SLATE};
    font-weight:500; line-height:1.04; }
  .qr { position:absolute; left:108mm; top:45mm; width:37mm; z-index:2; text-align:center; }
  .qr img { width:37mm; height:37mm; }
  .qr .cap { font-size:9pt; color:${SLATE}; font-weight:500; margin-top:1mm; }
  .intro { position:absolute; left:13mm; top:90mm; width:97mm; z-index:2;
    color:${SLATE}; font-size:13.5pt; font-weight:300; line-height:1.4; }
  .sched { position:absolute; left:13mm; top:120mm; width:104mm; z-index:2; color:${SLATE}; }
  .sched .range { font-size:21pt; font-weight:600; letter-spacing:0.3pt; text-transform:uppercase; }
  .sched .days { font-size:21pt; font-weight:600; text-transform:uppercase; }
  .sched .see-days { font-size:11.5pt; font-weight:500; letter-spacing:0.2pt; margin:1mm 0; }
  .sched .see-days .lnk { text-decoration:underline; }
  .sched .time { font-size:22pt; font-weight:300; margin-top:0.5mm; }
  .sched .time.split { font-size:17pt; }
  .burst { position:absolute; left:135mm; top:94mm; width:70mm; height:70mm; z-index:3; }
  .burst .txt { position:absolute; inset:6mm; display:flex; flex-direction:column;
    align-items:center; justify-content:center; text-align:center; color:#fff; z-index:2; }
  .burst-big { font-weight:700; line-height:1.05; }
  .burst-small { font-weight:600; line-height:1.25; margin-top:2mm; }
  .bullets { position:absolute; left:13mm; top:170mm; width:88mm; z-index:2; }
  .bullet { display:flex; align-items:flex-start; gap:4mm; margin-bottom:5mm;
    color:${SLATE}; font-size:13.5pt; font-weight:500; line-height:1.2; }
  .dot { flex:0 0 auto; width:5.5mm; height:5.5mm; border-radius:50%; background:${SLATE};
    border:0.9mm solid #bfe9fa; margin-top:1mm; }
  .cta { position:absolute; left:17mm; top:223mm; width:74mm; height:74mm; z-index:3; }
  .cta .txt { position:absolute; inset:8mm 8mm 22mm; display:flex; flex-direction:column;
    align-items:center; justify-content:center; text-align:center; color:#fff; z-index:2;
    font-size:15pt; font-weight:600; line-height:1.25; }
  .cta-pill { position:absolute; left:-3mm; top:54mm; min-width:86mm; z-index:4;
    background:${BLUE}; border-radius:7mm; padding:2.5mm 7mm; text-align:center; }
  .cta-pill span { color:#fff; font-size:21pt; font-weight:700; text-decoration:underline;
    letter-spacing:0.5pt; white-space:nowrap; }
  /* Spanish copy runs longer: smaller headline (3 lines), tighter intro/bullets. */
  .es .headline { top:43mm; }
  .es .intro { font-size:12.5pt; top:86mm; }
  .es .sched { top:126mm; }
  .es .sched .range, .es .sched .days { font-size:19pt; }
  .es .bullets { top:169mm; }
  .es .bullet { font-size:12.5pt; margin-bottom:4mm; }
  .es .cta .txt { font-size:13.5pt; }
  `

  const svgBands = `
  <svg class="band" style="left:0; top:0; width:210mm; height:297mm;" viewBox="0 0 210 297" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <!-- right diagonal band (under the top-right blob) -->
    <path d="M136,34 L210,22 L210,170 Z" fill="${BLUE}"/>
    <!-- top-left blue wave -->
    <path d="M0,0 L127,0 C112,18 92,26 74,32 C52,39 26,52 0,88 Z" fill="${BLUE}"/>
    <!-- top-right slate blob behind the school logo -->
    <path d="M133,0 L210,0 L210,48 C196,58 170,56 153,44 C144,37 135,24 133,0 Z" fill="#93a5b8"/>
  </svg>`

  const body = `
  ${svgBands}
  <img class="hero" src="${assets.hero}" alt="">
  <img class="hgl-logo" src="${assets.logoWhite}" alt="Higher Ground Learning">
  ${m.schoolLogoUrl ? `<div class="school-logo-wrap"><img src="${esc(m.schoolLogoUrl)}" alt=""></div>` : ''}
  <div class="headline" style="font-size:${headlinePt}pt;">${headline}</div>
  <div class="qr"><img src="${assets.qrDataUrl}" alt="QR"><div class="cap">${t.qrCaption}</div></div>
  <div class="intro">${flyerIntro(m, lang)}</div>
  <div class="sched">
    <div class="range">${esc(flyerDateRange(m, lang))}</div>
    ${
      days
        ? `<div class="days">${esc(days)}</div>`
        : `<div class="see-days">${t.seeDays(`<span class="lnk">${esc(m.linkDisplay).toUpperCase()}</span>`)}</div>`
    }
    ${time ? `<div class="time${m.timeBlocks.length > 1 ? ' split' : ''}">${esc(time)}</div>` : ''}
  </div>
  ${
    burst
      ? `<div class="burst">
          <div style="${brush(assets.brushMask, BLUE, 'inset:-2.5mm; transform:rotate(24deg); opacity:.95;')}"></div>
          <div style="${brush(assets.brushMask, accent, 'inset:0;')}"></div>
          <div class="txt">${burst}</div>
        </div>`
      : ''
  }
  <div class="bullets">
    ${t
      .bullets(m)
      .map((b) => `<div class="bullet"><div class="dot"></div><div>${b}</div></div>`)
      .join('')}
  </div>
  <div class="cta">
    <div style="${brush(assets.brushMask, BLUE, 'inset:-3mm; transform:rotate(203deg); opacity:.95;')}"></div>
    <div style="${brush(assets.brushMask, accent, 'inset:0; transform:rotate(90deg);')}"></div>
    <div class="txt">${t.cta}</div>
    <div class="cta-pill"><span>${esc(m.linkDisplay).toUpperCase()}</span></div>
  </div>`

  return pageShell(css, body, assets, lang)
}

// ---------------------------------------------------------------------------
// Parent letter (copy deck L-EN / L-ES)
// ---------------------------------------------------------------------------

const ICON = {
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><rect x="2.5" y="5" width="19" height="14" rx="1.5"/><path d="M3 6.5l9 6.5 9-6.5"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 18.5h4"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6"><path d="M12 21s-7-6.6-7-11.4A7 7 0 0 1 19 9.6C19 14.4 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.6"/></svg>`,
}

const LETTER_STATIC = {
  email: 'info@highergroundlearning.com',
  // §10.3: letterhead prints highergroundlearning.com (prep.com only forwards).
  site: 'www.highergroundlearning.com',
  phones: ['+1 801 524 0817', '+1 801 524 0827'],
  address: ['380 W. Pierpont Ave', 'Salt Lake City, UT'],
  country: { en: 'U.S.A.', es: 'EE.UU.' },
  title: { en: 'Director, International Programs', es: 'Rector, Programas Internacionales' },
}

function letterParagraphs(m: CollateralModel, lang: CollateralLanguage): string[] {
  const exam = esc(m.examName)
  const nick = esc(m.schoolNickname)
  const school = esc(m.schoolName)
  if (lang === 'es') {
    const parts = [
      `¡Nos complace anunciar que trabajaremos con los estudiantes de ${school} en el próximo curso de preparación para el ${exam}!`,
      `Como saben, la mayoría de las universidades estadounidenses manejan dentro de sus requisitos de admisión el examen ${exam}. Un alto puntaje en este examen no solo aumenta las posibilidades de ingreso a instituciones de gran prestigio, sino que también puede abrir puertas a becas y ayudas financieras.`,
      `En Higher Ground Learning hemos dedicado casi 30 años a preparar estudiantes de colegios internacionales alrededor del mundo para tener éxito en el ${exam}. Nuestros instructores no solo cuentan con puntajes sobresalientes y títulos de universidades de excelencia, sino que también saben motivar y acompañar a cada alumno en su camino. Clases dinámicas, enfoque personalizado y estrategias efectivas hacen que cada sesión sea una inversión en el futuro.`,
      `Además del curso grupal, cada estudiante recibirá gratis una sesión estratégica individual con su instructor, diseñada para reforzar sus puntos fuertes y trabajar áreas de mejora. Las tutorías privadas opcionales ofrecen una oportunidad adicional para resolver dudas y ganar confianza.`,
    ]
    const blurb = m.letterBlurbEs ?? m.letterBlurb
    if (blurb) parts.push(esc(blurb))
    parts.push(
      `¡Los lugares son limitados! Cuando la clase alcance el cupo de ${m.capacity} estudiantes, los siguientes registros pasarán a una lista de espera.`
    )
    return parts
  }
  const parts = [
    `We're excited to work with your students during the upcoming ${nick} ${exam} preparation course! As you may know, the ${exam} is an optional exam that is accepted by the majority of American universities as part of their application process. In addition to strong academic performance in a rigorous school curriculum, a great ${exam} score can open many options to students for university applications and admissions. Additionally, a great score can sometimes weigh heavily in scholarship and financial aid awards.`,
    `For nearly 30 years, Higher Ground Learning has been providing ${exam} test preparation to students at international schools around the globe. Our instructors have years of experience, top scores, and degrees from prestigious universities. But it's not just about credentials — our instructors provide an engaging, attentive classroom experience. The course only lasts a few weeks, but our instructors are uniquely focused on the students, producing tailored classes and content for each group. In addition, each student can attend a free personalized strategy session with the instructor to further tailor their approach. Flexible 1-on-1 tutoring sessions are available to help students tackle their own unique challenges.`,
  ]
  if (m.letterBlurb) parts.push(esc(m.letterBlurb))
  parts.push(
    `Spaces are limited! After the class hits the enrollment cap of ${m.capacity}, students will be added to a waitlist.`
  )
  return parts
}

function summaryBox(m: CollateralModel, lang: CollateralLanguage): string {
  const exam = esc(m.examName)
  const time = classTime(m, '&')
  const lines: string[] = []
  let heading: string
  if (lang === 'es') {
    // Deck L-ES heading prints the year alone (per the Nido example).
    heading = `Clase de preparación para el ${exam} ${m.firstSession.slice(0, 4)}`
    lines.push(
      `Impartido de forma ${m.inPerson ? `presencial en ${esc(m.schoolName)}` : 'en línea y en vivo'}`
    )
    lines.push(esc(letterDateRange(m, 'es')))
    const days = dayPattern(m, 'es')
    if (days || time) lines.push(esc([days, time?.toLowerCase()].filter(Boolean).join(' | ')))
    if (m.classroomHours) {
      lines.push(
        `${m.classroomHours} horas de clase + ${m.practiceTestCount} exámenes completos de práctica`
      )
    }
    if (m.enrollmentDeadline) {
      lines.push(`Fecha límite de inscripción: ${dayMonth(m.enrollmentDeadline, 'es', true)}`)
    }
    if (m.promo) {
      lines.push(
        `Regístrate antes del ${dayMonth(m.promo.deadline, 'es')} y usa el código «${esc(m.promo.code)}» para ahorrar ${esc(m.promo.amount)}`
      )
    }
    return boxHtml(heading, lines, `Más información e inscripción: `, m)
  }
  heading = `${monthYearLabel(m.firstSession, 'en')} ${esc(m.classType)} Class`
  lines.push(m.inPerson ? `Taught in-person at ${esc(m.schoolNickname)}` : 'Taught live online')
  lines.push(esc(letterDateRange(m, 'en')))
  if (time) lines.push(esc(time.toLowerCase()))
  if (m.classroomHours) {
    lines.push(
      `${m.classroomHours} hours classroom time + ${m.practiceTestCount} full-length ${exam === 'SAT' ? 'digital ' : ''}practice tests`
    )
  }
  if (m.enrollmentDeadline) {
    lines.push(`Registration deadline: ${dayMonth(m.enrollmentDeadline, 'en', true)}`)
  }
  if (m.promo) {
    lines.push(
      `Register before ${dayMonth(m.promo.deadline, 'en')} and use code &ldquo;${esc(m.promo.code)}&rdquo; to save ${esc(m.promo.amount)}`
    )
  }
  return boxHtml(heading, lines, `more info &amp; registration: `, m)
}

function boxHtml(heading: string, lines: string[], moreInfo: string, m: CollateralModel): string {
  return `<div class="box">
    <div class="box-h">${heading}</div>
    <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    <div class="box-f">${moreInfo}<span class="lnk">${esc(m.linkDisplay)}</span></div>
  </div>`
}

function letterClosing(m: CollateralModel, lang: CollateralLanguage): string {
  if (lang === 'es') {
    return `Estamos aquí para resolver cualquier consulta y acompañarlos en este proceso. No duden en escribirnos o llamarnos; será un privilegio ayudar a sus hijos a dar este paso importante hacia su futuro académico.`
  }
  const horizon = m.weeksUntilStart > 8 ? 'coming months' : 'coming weeks'
  return `In the ${horizon} before the course, we're available to answer any questions that you may have. Please feel free to call or email us at any time. We can't wait to help your student achieve their best score on the ${esc(m.examName)}!`
}

export function letterHtml(m: CollateralModel, lang: CollateralLanguage, assets: TemplateAssets): string {
  const salutation =
    lang === 'es' ? `Estimadas familias de ${esc(m.schoolNickname)}:` : `Dear ${esc(m.schoolNickname)} Parents:`

  const css = `
  .top-strip { position:absolute; left:0; top:0; width:210mm; height:23mm; z-index:1; }
  .top-contact { position:absolute; right:10mm; top:4mm; z-index:2; color:#fff; font-size:11pt; font-weight:400; }
  .top-contact .row { display:flex; align-items:center; gap:3mm; margin-bottom:1.6mm; }
  .top-contact svg { width:5.2mm; height:5.2mm; }
  .top-contact span { text-decoration:underline; }
  .letter-logo { position:absolute; left:17mm; top:15mm; width:52mm; z-index:2; }
  .content { position:absolute; left:17mm; top:52mm; width:176mm; z-index:2; color:#2f3e4c; }
  .salutation { font-size:15.5pt; font-weight:500; color:${SLATE}; margin-bottom:4.5mm; }
  .content p { font-size:10.3pt; font-weight:300; line-height:1.5; text-align:justify; margin-bottom:3.6mm; }
  .box { background:${BOX_BLUE}; border-radius:7mm; padding:4mm 10mm 4.5mm; margin:1.5mm 6mm 4.5mm; }
  .box-h { text-align:center; font-size:13pt; font-weight:700; color:#17313f; margin-bottom:1mm; }
  .box ul { margin-left:6mm; }
  .box li { font-size:11pt; font-weight:300; color:#2f3e4c; line-height:1.45; }
  .box-f { text-align:center; font-size:11.5pt; font-weight:700; color:#17313f; margin-top:1mm; }
  .box-f .lnk { text-decoration:underline; }
  .sig { display:flex; flex-direction:column; align-items:flex-end; margin:2mm 4mm 0 0; }
  .sig img { width:56mm; margin-bottom:-2mm; }
  .sig .name { font-size:15.5pt; font-weight:500; color:#17313f; }
  .sig .title { font-size:11pt; font-weight:400; color:#2f3e4c; }
  .bottom-strip { position:absolute; left:0; bottom:0; width:210mm; height:26mm; z-index:1; }
  .bottom-content { position:absolute; left:0; bottom:0; width:210mm; height:20mm; z-index:2;
    display:flex; align-items:center; gap:5mm; color:#fff; padding:0 12mm; }
  .bc-item { display:flex; align-items:center; gap:3mm; font-size:10.5pt; }
  .bc-item svg { width:6.5mm; height:6.5mm; }
  .bc-item .phones div { text-decoration:underline; line-height:1.35; }
  .bc-addr { line-height:1.3; }
  /* Spanish letter copy runs longer — tighten so the signature clears the strip. */
  .es .content { top:48mm; }
  .es .content p { font-size:9.8pt; margin-bottom:3.2mm; }
  .es .box li { font-size:10.5pt; }
  .es .sig img { width:50mm; }
  `

  // Letterhead angles: blue strip with a dark-navy wedge at its left end (top),
  // mirrored at the bottom — drawn as SVG so edges stay crisp at print size.
  const topStrip = `
  <svg class="top-strip" viewBox="0 0 210 23" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M96,0 L210,0 L210,20 L110,20 Z" fill="${BLUE}"/>
    <path d="M76,0 L124,0 L110,13 Z" fill="${INK}"/>
  </svg>`
  const bottomStrip = `
  <svg class="bottom-strip" viewBox="0 0 210 26" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,6 L146,6 L160,26 L0,26 Z" fill="${BLUE}"/>
    <path d="M132,6 L160,26 L210,26 L210,18 Z" fill="${INK}"/>
    <path d="M148,0 L210,10 L210,20 L141,6 Z" fill="${BLUE}" opacity="0"/>
  </svg>`

  const paragraphs = letterParagraphs(m, lang)
    .map((p) => `<p>${p}</p>`)
    .join('')

  const body = `
  ${topStrip}
  <div class="top-contact">
    <div class="row">${ICON.mail}<span>${LETTER_STATIC.email}</span></div>
    <div class="row">${ICON.globe}<span>${LETTER_STATIC.site}</span></div>
  </div>
  <img class="letter-logo" src="${assets.logoColor}" alt="Higher Ground Learning">
  <div class="content">
    <div class="salutation">${salutation}</div>
    ${paragraphs}
    ${summaryBox(m, lang)}
    <p>${letterClosing(m, lang)}</p>
    <div class="sig">
      ${assets.signatureDataUrl ? `<img src="${assets.signatureDataUrl}" alt="">` : '<div style="height:14mm"></div>'}
      <div class="name">William Thomas</div>
      <div class="title">${LETTER_STATIC.title[lang]}</div>
    </div>
  </div>
  ${bottomStrip}
  <div class="bottom-content">
    <div class="bc-item">${ICON.phone}<div class="phones">${LETTER_STATIC.phones.map((p) => `<div>${p}</div>`).join('')}</div></div>
    <div class="bc-item" style="margin-left:8mm;">${ICON.pin}<div class="bc-addr">${LETTER_STATIC.address.join('<br>')}<br>84109&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${LETTER_STATIC.country[lang]}</div></div>
  </div>`

  return pageShell(css, body, assets, lang)
}
