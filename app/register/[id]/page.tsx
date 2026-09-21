import { RegistrationForm } from './registration-form'
import { publicSkin } from '../../components/public-skin'
import SiteHeader from '../../components/SiteHeader'

// The URL segment is a human-readable slug (Squarespace buttons, print) —
// raw UUIDs still work for legacy links and Stripe cancel URLs. The form
// lives in registration-form.tsx (PL-384: shared with /{code}/register).
// PL-478: step 1 wears the full site header; the add-on / checkout-focus
// step gets the compact one (logo + "Back to class") — the form picks.

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const backHref = UUID_RE.test(id) ? '/classes' : `/c/${id}`
  return (
    <div className={publicSkin}>
      <RegistrationForm
        idOrSlug={id}
        header={<SiteHeader />}
        compactHeader={<SiteHeader variant="compact" backHref={backHref} backLabel={UUID_RE.test(id) ? 'Back to classes' : 'Back to class'} />}
      />
    </div>
  )
}
