import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/server/auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/** The signed-in user, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * For API routes: the signed-in user, or a 401 response to return.
 * (The proxy only checks that a session cookie exists; this validates it.)
 */
export async function requireUser(): Promise<SessionUser | NextResponse> {
  const user = await currentUser();
  return user ?? NextResponse.json({ error: "Sign in required" }, { status: 401 });
}
