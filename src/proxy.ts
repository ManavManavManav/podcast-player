import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends signed-out visitors to the sign-in page. This is only a fast,
 * cookie-presence check; every API route and page validates the session
 * properly on the server.
 */
export function proxy(req: NextRequest) {
  if (getSessionCookie(req)) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except sign-in pages, the auth API, health checks, cron jobs (they check
  // their own secret), and static assets.
  matcher: ["/((?!login|signup|api/auth|api/healthz|api/readyz|api/cron/|_next/|icon\\.svg|favicon\\.ico).*)"],
};
