import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  output: "standalone",
  // This repo has multiple lockfiles at the workspace root.
  // Explicitly set tracing root to silence Next's warning during dev/build.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
