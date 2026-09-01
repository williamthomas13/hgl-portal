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
      // PL-449: sharp's platform packages load via computed require paths the
      // tracer can't follow — ship the linux binaries explicitly (the Sep-1
      // incident: sharp failed to load in prod and killed every importing
      // route's module graph). Locally these globs match nothing (darwin
      // installs darwin binaries) — that's fine, includes are best-effort.
      './node_modules/sharp/**/*',
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
      './node_modules/@img/sharp-linux-arm64/**/*',
      './node_modules/@img/sharp-libvips-linux-arm64/**/*',
    ],
    // PL-449 amendment 2: the counselor-welcome send renders the SAME
    // collateral (letter PDF + flyer PDF/JPG attachments) in ITS function —
    // it was never in this map, so its lambda lacked both the template art
    // and the Chromium binary. Same includes as the artifact route.
    '/api/admin/class-confirmed': [
      './public/collateral/**/*',
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/sharp/**/*',
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
      './node_modules/@img/sharp-linux-arm64/**/*',
      './node_modules/@img/sharp-libvips-linux-arm64/**/*',
    ],
    // PL-449: the two direct sharp routes (logo upload, block-image variants).
    '/api/admin/school-logo': [
      './node_modules/sharp/**/*',
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
      './node_modules/@img/sharp-linux-arm64/**/*',
      './node_modules/@img/sharp-libvips-linux-arm64/**/*',
    ],
    '/api/admin/site-content/image': [
      './node_modules/sharp/**/*',
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
      './node_modules/@img/sharp-linux-arm64/**/*',
      './node_modules/@img/sharp-libvips-linux-arm64/**/*',
    ],
    // Phase 7e: agreement-acceptance PDF snapshots render in these functions
    // (same chromium-not-traced failure seen in prod July 15).
    '/api/agreements': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    '/api/admin/agreements': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },

  async redirects() {
    return [
      // PL-349: bare hgl.co (email signatures) is a PERMANENT 301 to the
      // main site — host-conditioned so it only fires once hgl.co's DNS
      // points at this app (the launch-tail cutover, PL-155b ordered pair).
      {
        source: '/',
        has: [{ type: 'host', value: 'hgl.co' }],
        destination: 'https://www.highergroundlearning.com',
        permanent: true,
      },
      {
        source: '/',
        has: [{ type: 'host', value: 'www.hgl.co' }],
        destination: 'https://www.highergroundlearning.com',
        permanent: true,
      },
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
