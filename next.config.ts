import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge sits on top of the player bar's controls.
  devIndicators: false,
  // Loaded from node_modules at runtime rather than bundled: the database
  // driver has native parts, and ffmpeg is a binary.
  serverExternalPackages: ["@libsql/client", "@libsql/kysely-libsql", "@ffmpeg-installer/ffmpeg"],
  // Ship the static ffmpeg binary with the function that runs it (on Vercel).
  outputFileTracingIncludes: {
    "/api/analyze": ["./node_modules/@ffmpeg-installer/linux-x64/**"],
  },
};

export default nextConfig;
