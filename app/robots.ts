import type { MetadataRoute } from 'next'
import { emailBaseUrl } from './utils/base-url'

// PL-359 C: explicit welcome for search AND LLM crawlers on the public
// pages; the admin side and every tokenized route stay out. Ships with the
// dark-until-cutover discipline — this file just makes the posture explicit
// (there was no robots.txt at all before).

const DISALLOW = [
  '/admin',
  '/api/',
  '/portal',
  '/login',
  '/auth/',
  '/tutoring/', // tokenized confirm/schedule/autopay links
  '/intake/',
  '/survey/',
  '/coverage/',
  '/convert/',
  '/refund/',
  '/unsubscribe/',
  '/waitlist/',
  '/availability',
  '/classroom-request',
  '/class-roster',
  '/link-help',
  '/success',
  '/addons',
  '/agreements',
  '/test-link',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      // Named so nobody wonders whether AI assistants are welcome — they
      // are, on the same terms as everyone else.
      {
        userAgent: ['GPTBot', 'ClaudeBot', 'Claude-Web', 'PerplexityBot', 'Google-Extended'],
        allow: '/',
        disallow: DISALLOW,
      },
    ],
    sitemap: `${emailBaseUrl()}/sitemap.xml`,
  }
}
