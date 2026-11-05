import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // PDF.js is loaded from node_modules at runtime instead of being bundled by webpack.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
