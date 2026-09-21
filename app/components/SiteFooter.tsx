import Link from 'next/link'
import { loadSiteNav, MAIN_SITE } from '../utils/site-nav'
import { loadContactInfo } from '../utils/tutoring-emails'

// PL-478: the shared public footer — the main site's footer links (editable
// list), WhatsApp + phone + email from the existing contact settings, the
// College Prep Compass sign-up (PL-477), © line. Same-tab links throughout.
export default async function SiteFooter() {
  const [{ footer }, contact] = await Promise.all([loadSiteNav(), loadContactInfo()])
  const digits = contact.phone.replace(/[^\d]/g, '')
  return (
    <footer className="bg-hgl-slate text-white/80 mt-16" data-testid="site-footer">
      <div className="max-w-6xl mx-auto px-4 sm:px-5 py-10 grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/collateral/hgl-logo-white.png" alt="Higher Ground Learning" className="h-10 w-auto mb-3" />
          <p className="text-white/70">Test prep and academic support — at partner schools around the world, online, and in Salt Lake City.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-2">
          {footer.filter((i) => i.show).map((it) => (
            <a key={it.url + it.label} href={it.url} className="hover:text-white">{it.label}</a>
          ))}
          <Link href="/compass" className="hover:text-white col-span-2 mt-1 font-semibold" data-testid="footer-compass">College Prep Compass — sign up →</Link>
        </nav>
        <div className="space-y-1">
          <p><a href={`mailto:${contact.email}`} className="hover:text-white">{contact.email}</a></p>
          <p><a href={`tel:${digits}`} className="hover:text-white">{contact.phone}</a></p>
          {digits && (
            <p><a href={`https://wa.me/${digits}`} className="hover:text-white" data-testid="footer-whatsapp">WhatsApp {contact.phone}</a></p>
          )}
          <p className="pt-3 text-white/50">© {new Date().getFullYear()} Higher Ground Learning · <a href={MAIN_SITE} className="hover:text-white">highergroundlearning.com</a></p>
        </div>
      </div>
    </footer>
  )
}
