import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@browserbasehq/stagehand", "pino", "pino-pretty", "thread-stream"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "target.scene7.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;