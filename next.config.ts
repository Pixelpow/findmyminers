import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  reactStrictMode: true,
  // Produce a self-contained server bundle for small Docker images.
  output: 'standalone',
};

export default nextConfig;
