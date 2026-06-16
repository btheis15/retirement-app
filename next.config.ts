import type { NextConfig } from "next";

/**
 * Deploys to Vercel as a serverless app (NOT a static export). It has
 * /api/ticker/* route handlers that proxy Yahoo Finance for ticker search and
 * price history — only ticker symbols are ever sent, never balances/identity —
 * so a static export is no longer possible. (The old GitHub Pages export mode
 * was retired for this reason.)
 *
 * Document routes + the manifest are served no-store so a fresh deploy reaches
 * the installed PWA immediately; /_next/static/* keep their immutable hashing,
 * and the /api routes set their own cache headers (search: 5 min; chart: daily).
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/((?!_next/static|api).*)",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
