// PL-103/PL-104 work types — LEAF MODULE (client-importable; no server-only
// imports, ever — regress:client-imports walks from 'use client' roots).
//
// The categories come from the paper timecard's columns (Scarlett's
// screenshot, Jul 23): Date · Student · Subject · hours by type ·
// Notes. They align with the QBO Payroll pay-type names; per-tutor extras
// ("chem prep", "International onsite") live in instructors.pay_type_titles
// and fold into that tutor's own option list. TITLES ONLY — no rates or
// dollar amounts anywhere in the portal.

export const STANDARD_WORK_TYPES = [
  'Test Prep',
  '1-on-1',
  '2-on-1',
  'Prep Time',
  'Class/Workshop',
  'Other',
] as const

/** Base pay in QBO covers the 1-on-1/Test Prep default; a null work_type
 *  on a tutoring session means this. */
export const DEFAULT_TUTORING_WORK_TYPE = '1-on-1'

/** Group-class sessions taught are always attributed here. */
export const CLASS_WORK_TYPE = 'Class/Workshop'

/** The work types one tutor can book hours under: the standard six plus
 *  that tutor's own QBO pay-type titles (deduped, standard order first). */
export function workTypeOptions(payTypeTitles: string[] | null | undefined): string[] {
  const extras = (payTypeTitles ?? [])
    .map((t) => t.trim())
    .filter((t) => t !== '' && !STANDARD_WORK_TYPES.includes(t as (typeof STANDARD_WORK_TYPES)[number]))
  return [...STANDARD_WORK_TYPES, ...[...new Set(extras)]]
}

/** Hours grouped by work type, standard categories first (in their fixed
 *  order), then extras alphabetically. Rows with 0 hours are dropped. */
export function hoursByWorkType(
  rows: { workType: string; hours: number }[]
): { workType: string; hours: number }[] {
  const totals = new Map<string, number>()
  for (const r of rows) {
    totals.set(r.workType, (totals.get(r.workType) ?? 0) + r.hours)
  }
  const order = (t: string) => {
    const i = (STANDARD_WORK_TYPES as readonly string[]).indexOf(t)
    return i === -1 ? STANDARD_WORK_TYPES.length : i
  }
  return [...totals.entries()]
    .map(([workType, hours]) => ({ workType, hours: Number(hours.toFixed(2)) }))
    .filter((r) => r.hours > 0)
    .sort((a, b) => order(a.workType) - order(b.workType) || a.workType.localeCompare(b.workType))
}

/** Minutes between two HH:MM(:SS) wall-clock times on the same day. */
export function sessionMinutes(startTime: string | null, endTime: string | null): number {
  if (!startTime || !endTime) return 0
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const m = toMin(endTime) - toMin(startTime)
  return m > 0 ? m : 0
}
