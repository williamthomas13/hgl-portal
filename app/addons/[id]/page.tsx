import {
  addDaysISO,
  loadClassBundles,
  loadTutoringPackages,
  localDate,
  packageSavings,
  verifyAddonToken,
} from '../../utils/lifecycle'

// Per-enrollment discounted tutoring add-on page — the target of email #9.
// Server component: the signed token is verified server-side, and the page
// honors pre_class pricing only until the class's first session, then
// automatically stops offering it.

export const dynamic = 'force-dynamic'

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-xl mx-auto bg-white p-8 rounded-lg shadow-md border-t-4 border-hgl-blue">
        <h1 className="text-2xl font-bold text-hgl-slate mb-4">{title}</h1>
        {children}
      </div>
    </div>
  )
}

export default async function AddonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { id: enrollmentId } = await params
  const { t: token } = await searchParams

  if (!token || !verifyAddonToken(enrollmentId, token)) {
    return (
      <Shell title="Invalid link">
        <p className="text-gray-600">This link isn&apos;t valid. Check the link in your email, or reply to it for help.</p>
      </Shell>
    )
  }

  // Find the enrollment's class bundle.
  const bundles = await loadClassBundles()
  const bundle = bundles.find((b) => b.enrollments.some((e) => e.id === enrollmentId))
  const enrollment = bundle?.enrollments.find((e) => e.id === enrollmentId)

  if (!bundle || !enrollment) {
    return (
      <Shell title="Not found">
        <p className="text-gray-600">We couldn&apos;t find this registration.</p>
      </Shell>
    )
  }

  const label = `${bundle.schoolLabel} — ${bundle.classType}`

  if (enrollment.addons.length > 0) {
    return (
      <Shell title="You're all set">
        <p className="text-gray-600">
          Tutoring is already added to this {label} registration:{' '}
          <strong>{enrollment.addons.map((a) => `${a.name} (${a.hours} hours)`).join(', ')}</strong>.
        </p>
      </Shell>
    )
  }

  // Pre-class pricing ends when the class starts.
  if (localDate(bundle.timezone) >= bundle.firstSession) {
    return (
      <Shell title="This offer has ended">
        <p className="text-gray-600">
          Pre-class tutoring pricing for {label} was available until the first session. Keep an eye
          on your inbox — a post-class tutoring offer follows the final session.
        </p>
      </Shell>
    )
  }

  const { pre } = await loadTutoringPackages()

  return (
    <Shell title="Discounted 1-on-1 tutoring">
      <p className="text-gray-600 mb-2">
        For <strong>{enrollment.studentFirstName}</strong>&apos;s {label} registration.
      </p>
      <p className="text-sm bg-yellow-50 text-yellow-800 rounded p-3 mb-6">
        These rates are only available before class starts —{' '}
        <strong>pricing ends {new Date(addDaysISO(bundle.firstSession, 0) + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</strong>.
      </p>
      <div className="space-y-3">
        {pre.map((p) => (
          <a
            key={p.id}
            href={`/api/addons/checkout?e=${enrollmentId}&t=${token}&p=${p.id}`}
            className="block border-2 border-gray-200 rounded-lg p-4 hover:border-hgl-blue transition"
          >
            <div className="flex justify-between items-center">
              <div>
                <p className="font-bold text-hgl-slate">{p.name}</p>
                <p className="text-sm text-gray-600">
                  {p.hours} hours at ${p.hourlyRate}/hr (regular ${p.regularHourlyRate}/hr)
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-hgl-slate">${p.packagePrice}</p>
                <p className="text-sm font-semibold text-green-600">Save ${packageSavings(p)}</p>
              </div>
            </div>
          </a>
        ))}
      </div>
    </Shell>
  )
}
