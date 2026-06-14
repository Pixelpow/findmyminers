import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  reactStrictMode: true,
  // Masque le logo/indicateur de dev Next.js (n'apparaît qu'en `next dev`).
  devIndicators: false,
  // Produce a self-contained server bundle for small Docker images.
  output: 'standalone',
  // Keep personal tooling and docs out of the standalone bundle
  // (they would otherwise be traced into Docker images / the Windows zip).
  outputFileTracingExcludes: {
    '*': ['superpowers/**', '.agents/**', '.aidesigner/**', '.claude/**', 'agent/**', 'docs/**', 'release/**'],
  },
};

export default nextConfig;
