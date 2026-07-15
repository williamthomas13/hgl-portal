import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript and ESLint errors should block production builds so bugs
  // don't ship silently. If you hit a blocker, fix the code — don't flip
  // these flags on.

  // Phase 4.5 collateral rendering: keep the Chromium packages out of the
  // bundler (native require) and ship the template art/fonts inside the
  // render function — they're read from disk and inlined as data URLs.
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  outputFileTracingIncludes: {
    // The key is a picomatch ROUTE GLOB: [id] would be a character class, so
    // dynamic segments must be escaped or the include silently never applies.
    '/api/classes/\\[id\\]/collateral/\\[artifact\\]': [
      './public/collateral/**/*',
      // The compressed Chromium binary is opened with dynamic fs paths, so
      // the tracer can't discover it — without this the lambda 500s with
      // "input directory /var/task/node_modules/@sparticuz/chromium/bin
      // does not exist" (seen in prod July 7).
      './node_modules/@sparticuz/chromium/bin/**/*',
    ],
    // Phase 7e: agreement-acceptance PDF snapshots render in these functions
    // (same chromium-not-traced failure seen in prod July 15).
    '/api/agreements': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    '/api/admin/agreements': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },

  async redirects() {
    return [
      // The portal has no public front page: parents arrive on per-class
      // /register/{slug} links from Squarespace. Temporary redirect so the
      // root can become the parent portal in Phase 4.
      {
        source: '/',
        destination: 'https://www.highergroundlearning.com',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
