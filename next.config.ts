import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  // Pin workspace root (multiple lockfiles exist above this dir).
  turbopack: { root: __dirname },
  allowedDevOrigins: ["192.168.1.244", "192.168.1.244:3000"],
};

// Vercel BotID only makes sense on Vercel (it needs the platform challenge infra).
// In local dev its client challenge can fail to init in private windows and block
// node creation, so we only wrap it in production.
export default process.env.NODE_ENV === "production" ? withBotId(nextConfig) : nextConfig;
