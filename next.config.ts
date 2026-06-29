import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://www.osbytes.io",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  allowedDevOrigins: ["192.168.1.244", "192.168.1.244:3000"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default process.env.NODE_ENV === "production" ? withBotId(nextConfig) : nextConfig;
