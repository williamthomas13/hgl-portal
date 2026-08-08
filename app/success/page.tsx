import { supabaseAdmin as supabase } from '../utils/supabase-admin'

// Payment-success landing (PL-308: Scarlett's copy, real student names).
// The checkout redirect carries ?session_id={CHECKOUT_SESSION_ID}; the
// checkout stamped that id onto each enrollment before redirecting, so the
// lookup needs no webhook race — the names are ready the moment the parent
// lands. No match (add-on hours purchase, ?already_paid=1 revisits, or a
// stripped query) falls back to generic copy rather than guessing.

/** "Bunji" · "Bunji and Maya" · "Bunji, Maya, and Theo" */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; already_paid?: string }>
}) {
  const { session_id: sessionId, already_paid: alreadyPaid } = await searchParams

  let names: string[] = []
  if (sessionId) {
    const { data } = await supabase
      .from('enrollments')
      .select('id, students ( first_name )')
      .eq('stripe_session_id', sessionId)
    names = ((data as { students: { first_name: string } | { first_name: string }[] | null }[]) ?? [])
      .map((e) => (Array.isArray(e.students) ? e.students[0] : e.students)?.first_name?.trim() ?? '')
      .filter(Boolean)
  }

  const who = joinNames(names)
  const plural = names.length > 1

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-10">
      <div className="bg-white p-10 rounded-lg shadow-lg text-center border-t-8 border-green-500 max-w-lg">
        <div className="text-green-500 text-6xl mb-4">🎉</div>
        {names.length > 0 ? (
          <>
            <h1 className="text-3xl font-bold text-hgl-slate mb-4">
              Registration and Payment Successful!
            </h1>
            <p className="text-gray-600 mb-4">
              Your registration is officially confirmed. We have sent a confirmation receipt to
              your email, and {who} {plural ? 'have' : 'has'} been added to the class roster.
            </p>
            <p className="text-gray-500 text-sm mb-8">
              Class details will arrive in the days before the first session. We&apos;re looking
              forward to having {who} in class!
            </p>
          </>
        ) : alreadyPaid ? (
          <>
            <h1 className="text-3xl font-bold text-hgl-slate mb-4">You&apos;re all set!</h1>
            <p className="text-gray-600 mb-4">
              This registration was already paid — nothing more to do. The receipt went to your
              email when the payment landed.
            </p>
            <p className="text-gray-500 text-sm mb-8">
              Class details will arrive in the days before the first session.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-hgl-slate mb-4">Payment Successful!</h1>
            <p className="text-gray-600 mb-4">
              Your payment went through and a receipt is on its way to your email.
            </p>
            <p className="text-gray-500 text-sm mb-8">Nothing else to do right now.</p>
          </>
        )}
        {/* Parents are never routed toward admin/dashboard. */}
        <a
          href="https://www.highergroundlearning.com"
          className="bg-hgl-blue text-white font-bold py-3 px-6 rounded hover:bg-hgl-blue-hover transition"
        >
          Back to Higher Ground Learning
        </a>
      </div>
    </div>
  )
}
