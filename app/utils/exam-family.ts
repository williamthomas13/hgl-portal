// PL-368: THE one exam-family switch — the email side (examInfoFor /
// {examName} / {examRegistrationLink}) and the class-page substitution both
// resolve through here, so they can never disagree on SAT/ACT/PSAT again.
// PSAT is checked FIRST ("PSAT Prep" contains "sat"), and PSAT registration
// goes through the student's SCHOOL — there is no public registration link,
// so both surfaces compose plain school-based wording instead of a wrong
// College Board URL. Client-safe leaf (no imports).

export type ExamFamily = {
  examName: 'PSAT' | 'ACT' | 'SAT'
  /** PSAT: registration is handled by the student's school — no link. */
  schoolBased: boolean
  /** Email FAQ link ("College Board Website") — null when schoolBased. */
  regLabel: string | null
  regUrl: string | null
  /** The /c pages' international-registration deep link — null when schoolBased. */
  pageRegUrl: string | null
}

export function examFamilyFor(classType: string | null | undefined): ExamFamily | null {
  const t = String(classType ?? '')
  if (/\bpsat\b/i.test(t)) {
    return { examName: 'PSAT', schoolBased: true, regLabel: null, regUrl: null, pageRegUrl: null }
  }
  if (/\bact\b/i.test(t)) {
    return {
      examName: 'ACT',
      schoolBased: false,
      regLabel: 'ACT Website',
      regUrl: 'https://www.act.org',
      pageRegUrl:
        'https://global.act.org/content/global/en/products-and-services/the-act-non-us/registration.html',
    }
  }
  if (/sat/i.test(t)) {
    return {
      examName: 'SAT',
      schoolBased: false,
      regLabel: 'College Board Website',
      regUrl: 'https://www.collegeboard.org',
      pageRegUrl:
        'https://satsuite.collegeboard.org/sat/registration/international-testing/dates-deadlines',
    }
  }
  return null
}

/** PL-412: is this tutoring SUBJECT a test-prep exam whose timecard rows
 *  should default to the 'Test Prep' work type? STRICT word boundaries on
 *  all three — unlike examFamilyFor's historical bare-substring SAT branch
 *  (kept as-is for class titles): "French" and "Satire" never match;
 *  "PSAT" and "SAT Subject Tests" do; "SSAT"/"ISEE" deliberately do NOT
 *  (their own exams — no SAT default, and the dropdown stays editable). */
export function isTestPrepExamSubject(name: string | null | undefined): boolean {
  if (!name) return false
  return /\bpsat\b/i.test(name) || /\bact\b/i.test(name) || /\bsat\b/i.test(name)
}

/** Mid-sentence registration guidance for schoolBased exams — fits both
 *  "…through the ___." (email FAQ) and "Visit ___ for…" (page fine print). */
export const SCHOOL_BASED_REG_TEXT =
  "student's school — PSAT registration is handled by the school, so ask the school's counseling office about dates and sign-up"
