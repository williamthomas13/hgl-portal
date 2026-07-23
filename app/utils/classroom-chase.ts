import { supabaseAdmin as supabase } from './supabase-admin'
import { formatDateShort } from './dates'

// PL-89/PL-93: the classroom-request chase, as one honest status line —
// "asked the counselor Jul 12 (opened Jul 12) · nudged Jul 16 (not yet
// opened) · last call not yet sent". Derived from the CR emails' own
// email_sends rows (dedupe key classroom_request:{classId}:{counselorId}:
// {round}), so the line and the actual sends can never disagree. Open state
// is pixel-based and directional (PL-93 honesty rule): rendered raw, no
// editorializing.

export type ChaseRound = {
  round: 0 | 1 | 2
  sentAt: string | null
  openedAt: string | null
}

export async function classroomChaseRounds(classId: string): Promise<ChaseRound[]> {
  const { data } = await supabase
    .from('email_sends')
    .select('dedupe_key, sent_at, first_opened_at, status')
    .like('dedupe_key', `classroom_request:${classId}:%`)
    .in('status', ['sent', 'delivered'])
  const rounds: ChaseRound[] = [0, 1, 2].map((r) => ({ round: r as 0 | 1 | 2, sentAt: null, openedAt: null }))
  for (const row of data ?? []) {
    const round = Number(row.dedupe_key.split(':').pop())
    if (round !== 0 && round !== 1 && round !== 2) continue
    const slot = rounds[round]
    // Multiple counselors per round: earliest send, any open counts.
    if (!slot.sentAt || (row.sent_at && row.sent_at < slot.sentAt)) slot.sentAt = row.sent_at
    if (row.first_opened_at && (!slot.openedAt || row.first_opened_at < slot.openedAt)) {
      slot.openedAt = row.first_opened_at
    }
  }
  return rounds
}

const ROUND_LABELS = ['asked the counselor', 'nudged', 'last call'] as const

/** "asked the counselor Jul 12, 2026 (opened Jul 12, 2026) · nudged … ·
 *  last call not yet sent" */
export function chaseLine(rounds: ChaseRound[]): string {
  return rounds
    .map((r) => {
      if (!r.sentAt) return `${ROUND_LABELS[r.round]} not yet sent`
      const open = r.openedAt
        ? ` (opened ${formatDateShort(r.openedAt.slice(0, 10))})`
        : ' (not yet opened)'
      return `${ROUND_LABELS[r.round]} ${formatDateShort(r.sentAt.slice(0, 10))}${open}`
    })
    .join(' · ')
}

export async function classroomChaseLine(classId: string): Promise<string> {
  return chaseLine(await classroomChaseRounds(classId))
}
