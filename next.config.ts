import type { NextConfig } from "next";

// Static export: the app runs entirely in the browser; show files never leave the machine.
// NEXT_PUBLIC_BASE_PATH is set to the repo name ("/gma1-patcher") for GitHub Pages, empty locally.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
