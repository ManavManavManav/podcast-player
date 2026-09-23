import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/lib/server/db";

/** Set PODBLOCK_ALLOW_SIGNUPS=false once everyone who should have an account has one. */
export const signupsAllowed = process.env.PODBLOCK_ALLOW_SIGNUPS !== "false";

/** Social sign-in is offered only for providers with credentials configured. */
const socialProviders = {
  ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET } }
    : {}),
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
    : {}),
};
export const enabledSocialProviders = Object.keys(socialProviders) as Array<"github" | "google">;

/** Built on first use, so importing this module never opens the database. */
function buildOptions() {
  return {
    appName: "Podblock",
    database: getDb(),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      disableSignUp: !signupsAllowed,
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily while in use
    },
    // Also accept sign-ins from other addresses the server is reachable at
    // (e.g. its LAN IP), comma-separated.
    trustedOrigins: process.env.PODBLOCK_TRUSTED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean),
    plugins: [nextCookies()],
  } satisfies BetterAuthOptions;
}

const createAuth = (options: ReturnType<typeof buildOptions>) => betterAuth(options);
export type Auth = ReturnType<typeof createAuth>;

/**
 * The auth instance, created after its tables exist: a fresh checkout needs no
 * separate migration step, and Better Auth's startup schema check (which runs
 * as soon as an instance is created) sees the finished schema.
 */
const globalForAuth = globalThis as unknown as { __podblockAuth?: Promise<Auth> };
export function getAuth(): Promise<Auth> {
  if (!globalForAuth.__podblockAuth) {
    const options = buildOptions();
    globalForAuth.__podblockAuth = getMigrations(options)
      .then(({ runMigrations }) => runMigrations())
      .then(() => createAuth(options))
      .catch((err) => {
        globalForAuth.__podblockAuth = undefined;
        throw err;
      });
  }
  return globalForAuth.__podblockAuth;
}
