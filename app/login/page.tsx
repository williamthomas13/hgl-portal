import { verifyLoginPrefillToken, safeNextPath } from '../utils/portal-auth'
import LoginForm from './login-form'

// Phase 4 login (PHASE4_SPEC §2): one email field, magic link + OTP code in a
// single email. Accounts are provisioned implicitly from existing data — no
// public signup. Staff can still use their password behind a toggle.
//
// pe/pt = signed email prefill from the #0 "View your registration" button;
// they may arrive top-level or embedded in the `next` URL (the proxy encodes
// the whole original path when it bounces a signed-out visitor here).
export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const next = safeNextPath(first(sp.next))

  let pe = first(sp.pe)
  let pt = first(sp.pt)
  if ((!pe || !pt) && next?.includes('?')) {
    const embedded = new URLSearchParams(next.slice(next.indexOf('?') + 1))
    pe = pe ?? embedded.get('pe') ?? undefined
    pt = pt ?? embedded.get('pt') ?? undefined
  }
  const prefillEmail = pe && pt && verifyLoginPrefillToken(pe, pt) ? pe : ''

  return (
    <LoginForm
      prefillEmail={prefillEmail}
      next={next ?? undefined}
      linkError={first(sp.error) === 'link'}
    />
  )
}
