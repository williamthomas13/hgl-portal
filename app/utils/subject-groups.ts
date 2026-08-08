// PL-320: ONE source for subject grouping. The subjects table only knows
// test_prep vs subject_tutoring; the human-facing grouping (Math · Science ·
// English · …) lives here and is reused everywhere subjects render — the
// tutors table summary, the expanded chip grid, and the edit-profile picker.
// Names not listed fall into "Other" (a future subject must never crash or
// vanish). Leaf-safe: no imports.

export const SUBJECT_GROUP_ORDER = [
  'Math',
  'Science',
  'English',
  'History & social studies',
  'Languages',
  'Test prep',
  'Other',
] as const

export type SubjectGroup = (typeof SUBJECT_GROUP_ORDER)[number]

const GROUP_BY_NAME: Record<string, SubjectGroup> = {
  // Math
  'Pre-Algebra': 'Math',
  'Algebra 1': 'Math',
  'Algebra 2': 'Math',
  Arithmetic: 'Math',
  Geometry: 'Math',
  Trigonometry: 'Math',
  'Pre-Calculus': 'Math',
  Calculus: 'Math',
  'AP/IB Calculus': 'Math',
  Statistics: 'Math',
  Math: 'Math',
  // Science
  Anatomy: 'Science',
  Biology: 'Science',
  'Biology Honors': 'Science',
  Chemistry: 'Science',
  'Chemistry Honors': 'Science',
  'Earth Science': 'Science',
  Physics: 'Science',
  'AP/IB Physics': 'Science',
  'Health & Nutrition': 'Science',
  Science: 'Science',
  // English
  English: 'English',
  Reading: 'English',
  Grammar: 'English',
  Essays: 'English',
  'Creative Writing': 'English',
  Literature: 'English',
  'World Literature': 'English',
  'Literary Theory': 'English',
  // History & social studies
  History: 'History & social studies',
  'US History': 'History & social studies',
  'European History': 'History & social studies',
  'World History': 'History & social studies',
  Geography: 'History & social studies',
  'Political Science': 'History & social studies',
  Psychology: 'History & social studies',
  // Languages
  Spanish: 'Languages',
  French: 'Languages',
  German: 'Languages',
  Italian: 'Languages',
  Latin: 'Languages',
  Chinese: 'Languages',
  Japanese: 'Languages',
  'Foreign Language': 'Languages',
  ESL: 'Languages',
}

/** Group for a subject. Anything in the test_prep DB category is "Test
 *  prep" regardless of name; unknown names land in "Other". */
export function subjectGroup(name: string, dbCategory?: string | null): SubjectGroup {
  if (dbCategory === 'test_prep') return 'Test prep'
  return GROUP_BY_NAME[name] ?? 'Other'
}

/** "Math (9) · Science (8) · Test prep (7)" — the compact per-tutor line.
 *  Groups render in SUBJECT_GROUP_ORDER; empty groups are skipped. */
export function groupSubjects(
  subjects: { name: string; category?: string | null }[]
): { group: SubjectGroup; names: string[] }[] {
  const buckets = new Map<SubjectGroup, string[]>()
  for (const s of subjects) {
    const g = subjectGroup(s.name, s.category)
    const list = buckets.get(g) ?? []
    list.push(s.name)
    buckets.set(g, list)
  }
  return SUBJECT_GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
    group: g,
    names: (buckets.get(g) ?? []).sort((a, b) => a.localeCompare(b)),
  }))
}
