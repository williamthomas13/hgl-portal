import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'
import EvergreenCapture from '../../components/EvergreenCapture'
import { publicSkin } from '../../components/public-skin'
import { RegistrationForm } from '../../register/[id]/registration-form'
import { bumpCodeVisit, resolveEvergreen, wildcardForward } from '../../utils/evergreen'

// PL-384 B: /{code}/register — the permanent registration address. Resolves
// the SAME class the code serves and renders the registration form in place;
// nothing open → the same interest-capture state (a printed register link
// never strands). Never indexed (forms aren't content).

export const dynamic = 'force-dynamic'

const CODE_RE = /^[a-z0-9-]{1,32}$/

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Register — Higher Ground Learning', robots: { index: false } }
}

export default async function EvergreenRegisterPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const raw = (await params).code
  const code = decodeURIComponent(raw).toLowerCase().trim()
  const fallbackCapture = (heading: string, classType: string, schoolId: string | null) => (
    <div className={`min-h-screen bg-gray-50 ${publicSkin}`}>
      <EvergreenCapture
        schoolId={schoolId}
        classType={classType}
        heading={heading}
        sub="Leave your email and we'll let you know the moment the next class opens for registration — nothing else, no newsletter."
      />
    </div>
  )
  // PL-448: an unknown code's /register subpath is just another unknown
  // hgl.co path — path-preserving wildcard 301 (registrar parity). Known
  // codes with nothing open still get the capture state below.
  if (!CODE_RE.test(code)) permanentRedirect(wildcardForward([raw, 'register']))
  const res = await resolveEvergreen(code)
  if (res.kind === 'legacy') permanentRedirect(res.destination)
  if (res.kind === 'school' || res.kind === 'course') {
    await bumpCodeVisit(code)
    if (res.classSlug)
      return (
        <div className={publicSkin}>
          <RegistrationForm idOrSlug={res.classSlug} />
        </div>
      )
    return fallbackCapture(
      res.kind === 'school'
        ? `No upcoming class at ${res.label} right now`
        : `No upcoming ${res.label} class right now`,
      res.classType,
      res.kind === 'school' ? res.schoolId : null
    )
  }
  // PL-448: not a code we know → the registrar-parity wildcard 301.
  permanentRedirect(wildcardForward([raw, 'register']))
}
