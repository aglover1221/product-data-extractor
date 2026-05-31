import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const noopPolyfill = path.join(__dirname, "lib/noop-polyfill.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "better-sqlite3",
      "pdf-parse",
      "pdf-to-png-converter"
    ]
  },
  webpack(config) {
    // Next.js bundles legacy polyfills unconditionally; alias them out for modern targets.
    config.resolve.alias = {
      ...config.resolve.alias,
      "../build/polyfills/polyfill-module": noopPolyfill,
      "next/dist/build/polyfills/polyfill-module": noopPolyfill
    };
    return config;
  }
};

export default nextConfig;
