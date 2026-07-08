# HGL Portal — Phase 4.5 Collateral Copy Deck

**Version:** 1.0 · July 7, 2026 · Companion to hgl-phase4.5-collateral-spec.md
**Conventions:** `{curlyBraces}` = template variables (spec §3). `{cond ? A : B}` = conditional rendering. Computed values per spec §3: {classroomHours}, {dateRange}, {dayPattern}, {classTime}. EN and ES are parallel templates — same structure, same variables. ES copy adapted from the approved Nido letter; EN from the approved ASF letter and the three flyer examples.

Rendering rules that apply everywhere:
- **Promo lines/burst** render only when `promo_code` + `promo_amount` + `promo_deadline` are all set.
- **Burst priority** (flyer): promo → enrollment deadline → collapse.
- **{examName}** derives from class_type (SAT Prep → "SAT", ACT Prep → "ACT"; other → the class_type text itself).
- **Delivery conditionals:** `{inPerson ? ... : ...}` keyed off `delivery_mode`.

---

## F-EN — Student Flyer (English)

**Headline:** {CLASS_TYPE} COURSE
**QR caption:** Scan to register

**Intro** (default; overridable via `flyer_blurb`):
{schoolNickname} has partnered with Higher Ground Learning to offer {durationPhrase} {inPerson ? "in-person" : "live online"} {examName} prep course{inPerson ? " taught at " + schoolNickname : ""}.

*({durationPhrase} computed: "a 4-week" / "a 2-weekend" style from session span; falls back to "an upcoming" if the pattern is irregular.)*

**Schedule block:**
{dateRange}
{dayPattern} *(fallback: "(visit {shortLink} to see class days)")*
{classTime}

**Burst — promo variant:**
SAVE {promoAmount}
SIGN UP BEFORE {promoDeadline} & USE CODE "{promoCode}"

**Burst — deadline variant:**
REGISTRATION CLOSES {enrollmentDeadline}
SAVE YOUR SPOT!

**Bullets:**
- {inPerson ? "In-person" : "Live online"} instruction from expert instructors
- {practiceTestCount} full-length tests
- Content, strategy, tactics, & timing
- Comprehensive curriculum

**CTA circle:**
Spaces are limited! More info, FAQs, and registration:
**{SHORTLINK}**

---

## F-ES — Student Flyer (Spanish)

**Headline:** CURSO DE PREPARACIÓN {examName}
**QR caption:** Escanea para inscribirte

**Intro** (default; overridable via `flyer_blurb`):
{schoolNickname} se ha asociado con Higher Ground Learning para ofrecer un curso de preparación para el {examName} {inPerson ? "presencial, impartido en " + schoolNickname : "en vivo y en línea"}{durationPhraseEs}.

*({durationPhraseEs} computed: " de 4 semanas" / " de 2 fines de semana"; omitted if irregular.)*

**Schedule block:**
{dateRange}
{dayPattern} *(ES day names; fallback: "(visita {shortLink} para ver los días de clase)")*
{classTime}

**Burst — promo variant:**
AHORRA {promoAmount}
INSCRÍBETE ANTES DEL {promoDeadline} CON EL CÓDIGO "{promoCode}"

**Burst — deadline variant:**
INSCRIPCIONES HASTA EL {enrollmentDeadline}
¡APARTA TU LUGAR!

**Bullets:**
- Instrucción {inPerson ? "presencial" : "en línea y en vivo"} con instructores expertos
- {practiceTestCount} exámenes completos de práctica
- Contenido, estrategia, tácticas y manejo del tiempo
- Plan de estudios integral

**CTA circle:**
¡Los lugares son limitados! Más información, preguntas frecuentes e inscripción:
**{SHORTLINK}**

---

## L-EN — Parent Letter (English)

**Salutation:** Dear {schoolNickname} Parents:

**Paragraph 1 — why the exam matters:**
We're excited to work with your students during the upcoming {schoolNickname} {examName} preparation course! As you may know, the {examName} is an optional exam that is accepted by the majority of American universities as part of their application process. In addition to strong academic performance in a rigorous school curriculum, a great {examName} score can open many options to students for university applications and admissions. Additionally, a great score can sometimes weigh heavily in scholarship and financial aid awards.

**Paragraph 2 — HGL credibility:**
For nearly 30 years, Higher Ground Learning has been providing {examName} test preparation to students at international schools around the globe. Our instructors have years of experience, top scores, and degrees from prestigious universities. But it's not just about credentials — our instructors provide an engaging, attentive classroom experience. The course only lasts a few weeks, but our instructors are uniquely focused on the students, producing tailored classes and content for each group. In addition, each student can attend a free personalized strategy session with the instructor to further tailor their approach. Flexible 1-on-1 tutoring sessions are available to help students tackle their own unique challenges.

**Optional paragraph — {letterBlurb}** *(rendered verbatim as its own paragraph when set; e.g. returning-school framing, school-specific notes)*

**Scarcity line:**
Spaces are limited! After the class hits the enrollment cap of {capacity}, students will be added to a waitlist.

**Summary box:**
**{monthYear} {classType} Class**
- Taught {inPerson ? "in-person at " + schoolNickname : "live online"}
- {dateRange}
- {classTime}
- {classroomHours} hours classroom time + {practiceTestCount} full-length practice tests
- *(if enrollment_deadline)* Registration deadline: {enrollmentDeadline}
- *(if promo)* Register before {promoDeadline} and use code "{promoCode}" to save {promoAmount}
**more info & registration: {shortLink}**

**Closing:**
In the {weeksUntilStart > 8 ? "coming months" : "coming weeks"} before the course, we're available to answer any questions that you may have. Please feel free to call or email us at any time. We can't wait to help your student achieve their best score on the {examName}!

**Signature block:** [signature image]
William Thomas
Director, International Programs

**Letterhead (static):**
Top: info@highergroundlearning.com · www.highergroundlearning.com
Bottom: +1 801 524 0817 · +1 801 524 0827 · 380 W. Pierpont Ave, Salt Lake City, UT 84109, U.S.A.

---

## L-ES — Parent Letter (Spanish)

**Salutation:** Estimadas familias de {schoolNickname}:

**Paragraph 1 — opening + why the exam matters:**
¡Nos complace anunciar que trabajaremos con los estudiantes de {schoolName} en el próximo curso de preparación para el {examName}!

Como saben, la mayoría de las universidades estadounidenses manejan dentro de sus requisitos de admisión el examen {examName}. Un alto puntaje en este examen no solo aumenta las posibilidades de ingreso a instituciones de gran prestigio, sino que también puede abrir puertas a becas y ayudas financieras.

**Paragraph 2 — HGL credibility:**
En Higher Ground Learning hemos dedicado casi 30 años a preparar estudiantes de colegios internacionales alrededor del mundo para tener éxito en el {examName}. Nuestros instructores no solo cuentan con puntajes sobresalientes y títulos de universidades de excelencia, sino que también saben motivar y acompañar a cada alumno en su camino. Clases dinámicas, enfoque personalizado y estrategias efectivas hacen que cada sesión sea una inversión en el futuro.

**Paragraph 3 — strategy session + tutoring:**
Además del curso grupal, cada estudiante recibirá gratis una sesión estratégica individual con su instructor, diseñada para reforzar sus puntos fuertes y trabajar áreas de mejora. Las tutorías privadas opcionales ofrecen una oportunidad adicional para resolver dudas y ganar confianza.

**Optional paragraph — {letterBlurb}** *(if the school wants ES-specific custom copy, the blurb is written in Spanish; the field is per-class and language-agnostic — when language = both, admin card shows one blurb field per language: `letter_blurb` (EN) and `letter_blurb_es`)*

**Scarcity line:**
¡Los lugares son limitados! Cuando la clase alcance el cupo de {capacity} estudiantes, los siguientes registros pasarán a una lista de espera.

**Summary box:**
**Clase de preparación para el {examName} {year}**
- Impartido de forma {inPerson ? "presencial en " + schoolName : "en línea y en vivo"}
- {dateRange}
- {dayPattern} | {classTime}
- {classroomHours} horas de clase + {practiceTestCount} exámenes completos de práctica
- *(if enrollment_deadline)* Fecha límite de inscripción: {enrollmentDeadline}
- *(if promo)* Regístrate antes del {promoDeadline} y usa el código «{promoCode}» para ahorrar {promoAmount}
**Más información e inscripción: {shortLink}**

**Closing:**
Estamos aquí para resolver cualquier consulta y acompañarlos en este proceso. No duden en escribirnos o llamarnos; será un privilegio ayudar a sus hijos a dar este paso importante hacia su futuro académico.

**Signature block:** [signature image]
William Thomas
Rector, Programas Internacionales

**Letterhead (static):**
Top: info@highergroundlearning.com · www.highergroundlearning.com
Bottom: +1 801 524 0817 · +1 801 524 0827 · 380 W. Pierpont Ave, Salt Lake City, UT 84109, EE.UU.

---

## Counselor-facing sharing note (portal + digest, EN only)

Rendered next to the download buttons in the counselor view and linked from the digest:

> **How to share these materials:** The flyer works well on bulletin boards, hallway screens, and in student newsletters (use the JPG for screens and digital, the PDF for printing). The letter is written for parents — forward it in your parent communications or print it for distribution. Both always reflect the latest class details, so if the schedule changes, please re-download rather than reusing saved copies.

---

## ⚠️ Notes & deltas from the source examples

1. **"Nearly 30 years" vs "30 años":** the EN letter says "nearly 30 years," the Nido ES letter says "30 años." Standardized to "casi 30 años" in ES for accuracy parity — revert if you'd rather round up in Spanish.
2. **highergroundprep.com → highergroundlearning.com** on the letterhead per resolved decision §10.3.
3. **ES letter opener:** Nido's original says "trabajaremos nuevamente" (working together *again*) — that's returning-school framing, which belongs in {letterBlurb}, not the default template. Default ES opener drops "nuevamente."
4. **`letter_blurb_es`:** the ES letter section introduces a second blurb column when language = both. Needs a one-line addition to the spec's schema section (classes: `letter_blurb_es`, text, nullable) — flagged for the spec's next revision or the migration itself.
5. **Closing time-phrase conditional:** EN closing renders "coming months" vs "coming weeks" from {weeksUntilStart} so an August letter about a September class doesn't say "months." ES closing is time-neutral and needs no conditional.
6. **Flyer ES headline:** rendered as "CURSO DE PREPARACIÓN SAT" (exam name after) rather than a literal translation of the EN order — reads more naturally at poster size. Open to alternatives.
