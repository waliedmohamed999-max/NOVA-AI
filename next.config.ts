import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: the app is also opened as http://127.0.0.1:3000 locally. Without this, Next blocks the
  // dev JS/HMR for that host and the page renders without any interactivity (no-op in production).
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@node-rs/argon2", "pino", "pino-pretty", "sharp", "unpdf"],
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Everything except the embeddable lead-capture widget refuses framing (CSP frame-ancestors is set in proxy.ts).
      { source: "/((?!embed/).*)", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
    ];
  },
};

export default withNextIntl(nextConfig);
