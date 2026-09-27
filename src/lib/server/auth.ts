import { createHash, timingSafeEqual } from "node:crypto";
import { LibsqlDialect, type LibsqlDialectConfig } from "@libsql/kysely-libsql";
import type { Client } from "@libsql/client";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { adminEmail } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { log } from "@/lib/server/log";
import { ensureAuthSchema } from "@/lib/server/migrations";

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

async function adminExists(db: Client): Promise<boolean> {
  const { rows } = await db.execute(`SELECT 1 FROM "user" WHERE role = 'admin' LIMIT 1`);
  return rows.length > 0;
}

/** Whether the admin account exists yet (until it does, creating it takes the setup code). */
export async function hasAdmin(): Promise<boolean> {
  return adminExists(await getDb());
}

/** Where the sign-up form sends the one-time setup code. */
export const SETUP_CODE_HEADER = "x-podblock-setup-code";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Why the owner's account (PODBLOCK_ADMIN_EMAIL) may not be created this
 * way, or null if it may. Signing up with an email address proves nothing
 * about owning it, so that takes the setup code (PODBLOCK_SETUP_CODE); an
 * address GitHub or Google has verified is proof enough.
 */
export function ownerSignUpRefusal(
  user: { emailVerified?: boolean | null },
  context: { path?: string; headers?: Headers } | null,
): string | null {
  const viaProvider = context?.path?.startsWith("/callback") ?? false;
  if (viaProvider && user.emailVerified) return null;
  const expected = process.env.PODBLOCK_SETUP_CODE ?? "";
  if (!expected) {
    return "The admin account needs a setup code: set PODBLOCK_SETUP_CODE on the server, then enter it here.";
  }
  const given = context?.headers?.get(SETUP_CODE_HEADER) ?? "";
  // Compared as digests, so the time taken says nothing about the code.
  return timingSafeEqual(digest(given), digest(expected)) ? null : "That setup code isn't right.";
}

/**
 * Anyone can sign up, but new accounts wait for the admin's approval before
 * they can use anything (every listen costs the owner API credit). The
 * account with PODBLOCK_ADMIN_EMAIL becomes the admin. Until it exists, no
 * one else can sign up, so nobody can claim that email first.
 */
export function getAuthOptions(db: Client) {
  return {
    appName: "Podblock",
    // Better Auth's own messages, in the same structured log.
    logger: {
      log: (level, message, ...args) => log[level]("auth", { message, ...(args.length ? { details: args } : {}) }),
    },
    database: {
      // The adapter is typed against an older @libsql/client; the calls it
      // makes (execute, batch, transactions) are the same in this one.
      dialect: new LibsqlDialect({ client: db as unknown as Extract<LibsqlDialectConfig, { client: unknown }>["client"] }),
      type: "sqlite",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
    },
    socialProviders,
    // On by default in production. Counts go in the database: the default
    // in-memory store is per server instance, so on serverless hosts each
    // instance would count sign-in attempts separately.
    rateLimit: { storage: "database" },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily while in use
      // Most requests read the session from a signed cookie instead of the
      // database. Kept short: a disabled account keeps access for up to this
      // long, and checks where that matters (approval, admin) skip the cache.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    user: {
      additionalFields: {
        approved: { type: "boolean", defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const owner = adminEmail();
            if (!owner) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-ups aren't open yet: this server has no admin configured.",
              });
            }
            if (user.email.toLowerCase() === owner) {
              const refusal = ownerSignUpRefusal(user, context);
              if (refusal) {
                log.warn("auth.owner_signup_refused", { viaProvider: Boolean(context?.path?.startsWith("/callback")) });
                throw new APIError("FORBIDDEN", { message: refusal });
              }
              return { data: { ...user, approved: true, role: "admin" } };
            }
            if (!(await adminExists(db))) {
              throw new APIError("FORBIDDEN", { message: "Sign-ups open once the owner has created their account." });
            }
            return { data: { ...user, approved: false } };
          },
        },
      },
    },
    // Also accept sign-ins from other addresses the server is reachable at
    // (e.g. its LAN IP), comma-separated.
    trustedOrigins: process.env.PODBLOCK_TRUSTED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean),
    plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] }), nextCookies()],
  } satisfies BetterAuthOptions;
}

const createAuth = (options: ReturnType<typeof getAuthOptions>) => betterAuth(options);
export type Auth = ReturnType<typeof createAuth>;

/**
 * If the admin's account already exists (e.g. the email was set later), make
 * sure it's the admin. Only an account the admin approved or whose email a
 * provider verified: otherwise whoever signed up with that address first
 * would be promoted.
 */
async function promoteAdmin(db: Client) {
  const owner = adminEmail();
  if (!owner) return;
  await db.execute({
    sql: `UPDATE "user" SET role = 'admin', approved = 1, banned = 0
          WHERE lower(email) = ? AND (role = 'admin' OR approved = 1 OR "emailVerified" = 1)`,
    args: [owner],
  });
}

/**
 * The auth instance, created after its tables exist: a fresh database needs
 * no separate migration step, and Better Auth's startup schema check (which
 * runs as soon as an instance is created) sees the finished schema. An
 * up-to-date database costs one read here.
 */
const globalForAuth = globalThis as unknown as { __podblockAuth?: Promise<Auth> };
export function getAuth(): Promise<Auth> {
  if (!globalForAuth.__podblockAuth) {
    globalForAuth.__podblockAuth = (async () => {
      const db = await getDb();
      const options = getAuthOptions(db);
      await ensureAuthSchema(db, options);
      await promoteAdmin(db);
      return createAuth(options);
    })().catch((err) => {
      globalForAuth.__podblockAuth = undefined;
      throw err;
    });
  }
  return globalForAuth.__podblockAuth;
}
