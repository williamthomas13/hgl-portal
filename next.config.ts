import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript and ESLint errors should block production builds so bugs
  // don't ship silently. If you hit a blocker, fix the code — don't flip
  // these flags on.

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
