import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,

  // Firebase Hosting is static-only. Enable Next.js static export.
  // `next build` will emit to `/out`.
  output: "export",

  // Ensure routes like `/profile` work as `/profile/index.html` without extra rewrites.
  trailingSlash: true,

  // `next/image` optimization requires a server; disable for static export.
  images: { unoptimized: true },

  // This repo has multiple lockfiles at the workspace root.
  // Explicitly set tracing root to silence Next's warning during dev/build.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
