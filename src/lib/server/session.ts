import { headers } from "next/headers";
import { cache } from "react";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/server/auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: "admin" | "user";
  /** Approved by the admin; until then the account can't use the app. */
  approved: boolean;
}

/**
 * The signed-in user, or null. Usually answered from the session cookie
 * cache (up to a minute old); `fresh` asks the database, for checks where a
 * just-changed approval or role matters. Once per request per kind.
 */
export async function currentUser({ fresh = false }: { fresh?: boolean } = {}): Promise<SessionUser | null> {
  const user = await loadUser(fresh);
  // A cached "waiting for approval" may be out of date; only those users pay for the check.
  if (!fresh && user && !user.approved) return loadUser(true);
  return user;
}

const loadUser = cache(async (fresh: boolean): Promise<SessionUser | null> => {
  // Headers first: while prerendering at build time this marks the page
  // dynamic before auth starts, so `next build` never opens the database.
  const requestHeaders = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: requestHeaders,
    ...(fresh ? { query: { disableCookieCache: true } } : {}),
  });
  if (!session) return null;
  const { user } = session;
  const role = user.role === "admin" ? "admin" : "user";
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role,
    approved: role === "admin" || Boolean(user.approved),
  };
});

/**
 * For API routes: the signed-in, approved user, or an error response to
 * return. (The proxy only checks that a session cookie exists; this
 * validates it.)
 */
export async function requireUser({ fresh = false }: { fresh?: boolean } = {}): Promise<SessionUser | NextResponse> {
  const user = await currentUser({ fresh });
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!user.approved) return NextResponse.json({ error: "Your account is waiting for approval" }, { status: 403 });
  return user;
}

/** For admin API routes: the signed-in admin, or an error response to return. */
export async function requireAdmin(): Promise<SessionUser | NextResponse> {
  const user = await requireUser({ fresh: true });
  if (user instanceof NextResponse) return user;
  if (user.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  return user;
}
