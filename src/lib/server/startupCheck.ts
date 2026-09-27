import { checkEnv } from "@/lib/server/envSchema.mjs";
import { log } from "@/lib/server/log";

/**
 * Checks the configuration when a server instance starts: in production a
 * broken one stops the server with a clear message, rather than failing on
 * the first request that needs the setting.
 */
export function checkConfiguration() {
  const production = process.env.NODE_ENV === "production";
  const { errors, warnings } = checkEnv(process.env, { production, vercel: Boolean(process.env.VERCEL) });
  for (const message of warnings) log.warn("config.warning", { message });
  if (errors.length === 0) return;
  log.error("config.invalid", { errors });
  if (production) throw new Error(`Podblock isn't configured correctly:\n- ${errors.join("\n- ")}`);
}
