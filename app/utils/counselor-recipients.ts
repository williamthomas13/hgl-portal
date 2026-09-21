import { supabaseAdmin as supabase } from './supabase-admin'
import { localDate, registrationCloseFor, type ClassBundle } from './lifecycle'
import { classQuietReason } from './class-quiet'

// PL-471 D: the counselor-recipient rules lived inside the cron route; the
// send projector needs the SAME rules to say who a sweep would email, so
// they live here now — one source for the sweep and the pre-flight.

/** One ACTIVE school affiliation + its contact. `id` is the affiliation id —
 *  digest tokens, digest_last_sent_at, dedupe keys, AND classes.counselor_id
 *  all bind to it (addendum §6). */
export type CounselorRow = {
  id: string
  school_id: string
  first_name: string
  email: string
  digest_frequency: 'weekly' | 'biweekly' | 'monthly' | 'paused'
  digest_last_sent_at: string | null
}

export async function loadCounselorsBySchool(): Promise<Map<string, CounselorRow[]>> {
  const { data, error } = await supabase
    .from('school_affiliations')
    .select('id, school_id, digest_frequency, digest_last_sent_at, contacts ( first_name, email )')
    .is('ended_at', null)
  if (error || !data) {
    console.error('loadCounselorsBySchool failed:', error?.message)
    return new Map()
  }
  const map = new Map<string, CounselorRow[]>()
  for (const row of data) {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
    if (!contact) continue
    const c: CounselorRow = {
      id: row.id,
      school_id: row.school_id,
      first_name: contact.first_name,
      email: contact.email,
      digest_frequency: row.digest_frequency as CounselorRow['digest_frequency'],
      digest_last_sent_at: row.digest_last_sent_at,
    }
    map.set(c.school_id, [...(map.get(c.school_id) ?? []), c])
  }
  return map
}

/** Recipients for CLASS-specific sends (classroom requests, final-days push,
 *  class-full note): the class's designated school contact when set, else
 *  every contact at the school. Digests stay school-wide regardless. */
export function contactsForClass(
  bundle: ClassBundle,
  counselorsBySchool: Map<string, CounselorRow[]>
): CounselorRow[] {
  if (!bundle.schoolId) return []
  const all = counselorsBySchool.get(bundle.schoolId) ?? []
  if (bundle.counselorId) {
    const chosen = all.filter((c) => c.id === bundle.counselorId)
    if (chosen.length > 0) return chosen
  }
  return all
}

/** Classes a counselor's digest covers: registration still open, not
 *  cancelled — and PL-471: never a quiet class (a records-only roster is not
 *  the school's enrollment picture to follow here). */
export function digestClasses(bundles: ClassBundle[], schoolId: string): ClassBundle[] {
  return bundles.filter(
    (b) =>
      b.schoolId === schoolId &&
      b.status !== 'cancelled' &&
      !classQuietReason(b) &&
      localDate(b.timezone) <= registrationCloseFor(b)
  )
}

/** Minimum days between digests per frequency (with slack for cron jitter). */
export const DIGEST_INTERVAL_DAYS: Record<string, number> = { weekly: 6, biweekly: 13, monthly: 27 }
