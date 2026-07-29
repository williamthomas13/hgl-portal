import { emailBaseUrl } from './base-url'
import { mintToken, checkToken } from './signing'

// PL-219 v1.5: survey link tokens — the house HMAC pattern (signing.ts).
// Two kinds, one page:
//   c.{classId}.{sig}      — the in-class link/QR (always anonymous)
//   s.{enrollmentId}.{sig} — the per-student email link (the named channel)
// 'family-form' lifetime (90 days) comfortably covers a term's tail.

export function classSurveyToken(classId: string): string {
  return `c.${classId}.${mintToken('survey_class:', classId, 'family-form')}`
}

export function studentSurveyToken(enrollmentId: string): string {
  return `s.${enrollmentId}.${mintToken('survey_student:', enrollmentId, 'family-form')}`
}

export type SurveyTokenInfo =
  | { kind: 'class'; classId: string }
  | { kind: 'student'; enrollmentId: string }

export function verifySurveyToken(token: string): SurveyTokenInfo | 'expired' | null {
  const [kind, id, ...rest] = token.split('.')
  const sig = rest.join('.')
  if (!id || !sig) return null
  if (kind === 'c') {
    const r = checkToken('survey_class:', id, sig, 'family-form')
    return r === 'ok' ? { kind: 'class', classId: id } : r === 'expired' ? 'expired' : null
  }
  if (kind === 's') {
    const r = checkToken('survey_student:', id, sig, 'family-form')
    return r === 'ok' ? { kind: 'student', enrollmentId: id } : r === 'expired' ? 'expired' : null
  }
  return null
}

export function classSurveyUrl(classId: string): string {
  return `${emailBaseUrl()}/survey/${classSurveyToken(classId)}`
}

export function studentSurveyUrl(enrollmentId: string): string {
  return `${emailBaseUrl()}/survey/${studentSurveyToken(enrollmentId)}`
}
