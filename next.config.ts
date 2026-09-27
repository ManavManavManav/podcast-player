import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/securityHeaders";

const nextConfig: NextConfig = {
  // The floating dev badge sits on top of the player bar's controls.
  devIndicators: false,
  // Other hosts the dev server is opened from (e.g. over a LAN or tailnet),
  // comma-separated, so live reload works there too.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean),
  // Loaded from node_modules at runtime rather than bundled: the database
  // driver has native parts, and ffmpeg is a binary.
  serverExternalPackages: ["@libsql/client", "@libsql/kysely-libsql", "ffmpeg-static"],
  // Ship the static ffmpeg binary with the function that runs it (on Vercel).
  outputFileTracingIncludes: {
    "/api/analyze": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ dev: process.env.NODE_ENV === "development" }) }];
  },
};

export default nextConfig;
