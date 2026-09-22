import { loadSiteNav, visibleNav } from '../utils/site-nav'
import { loadContactInfo } from '../utils/tutoring-emails'
import { PUBLIC_CONTACT_EMAIL } from '../utils/public-contact'
import { publicSkin } from './public-skin'
import FooterCompassForm from './FooterCompassForm'

// PL-478: the shared public footer — the main site's footer links (editable
// list), the College Prep Compass sign-up (PL-477), © line. Same-tab links.
// PL-493 (Scarlett, Sep 22): it now matches the main site's footer — white,
// black text, blue links, Pontano 17px; the newsletter block on the left
// (the Compass capture), the link columns beside it, the © line bottom
// right. The public address is info@ (PUBLIC_CONTACT_EMAIL) — never the
// tutoring contact's inbox; the phone stays the contact setting.
export default async function SiteFooter() {
  const [{ footer }, contact] = await Promise.all([loadSiteNav(), loadContactInfo()])
  const groups = visibleNav(footer)
  const digits = contact.phone.replace(/[^\d]/g, '')
  const link = 'text-hgl-blue hover:underline'
  return (
    <footer className={`${publicSkin} bg-white text-black border-t border-gray-200 mt-16 text-[17px]`} data-testid="site-footer">
      <div className="mx-auto max-w-[1500px] px-5 sm:px-8 lg:px-[57px] py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14">
        <div className="lg:col-span-5" data-testid="footer-newsletter">
          <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">Finally get something useful in your inbox</h2>
          <p className="mt-3 text-gray-700">
            Sign up to receive occasional discounts, SAT/ACT info, strategy tips, college prep advice, and more.
          </p>
          <div className="mt-5">
            <FooterCompassForm />
          </div>
          <p className="mt-3 text-sm text-gray-500">
            We won&apos;t share your info, and if our messages stop being useful to you later, it will be super easy to unsubscribe.
          </p>
        </div>
        <nav aria-label="Footer" className="lg:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-8">
          {groups.map((g, i) =>
            g.children ? (
              <div key={`${g.label}-${i}`} data-nav-group={g.label || `column-${i + 1}`}>
                {g.label && <p className="font-semibold mb-2">{g.label}</p>}
                <ul className="space-y-2">
                  {g.children.map((c) => (
                    <li key={c.url + c.label}>
                      <a href={c.url} className={link}>{c.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div key={g.url + g.label}>
                <a href={g.url} className={link}>{g.label}</a>
              </div>
            )
          )}
        </nav>
      </div>
      <div className="mx-auto max-w-[1500px] px-5 sm:px-8 lg:px-[57px] pb-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 text-sm text-gray-600">
        <p className="space-x-2">
          <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`} className={link} data-testid="footer-email">{PUBLIC_CONTACT_EMAIL}</a>
          <span aria-hidden>·</span>
          <a href={`tel:${digits}`} className={link}>{contact.phone}</a>
          {digits && (
            <>
              <span aria-hidden>·</span>
              <a href={`https://wa.me/${digits}`} className={link} data-testid="footer-whatsapp">WhatsApp</a>
            </>
          )}
        </p>
        <p className="sm:text-right">© {new Date().getFullYear()} Higher Ground Learning. Some rights reserved.</p>
      </div>
    </footer>
  )
}
