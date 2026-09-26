// The docs call it unstable_doesProxyMatch; this Next.js version exports the older name.
import { getRedirectUrl, unstable_doesMiddlewareMatch as matches } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { config, proxy } from "@/proxy";

const runsFor = (url: string) => matches({ config, nextConfig, url });

describe("proxy", () => {
  it("runs for the app's pages and APIs, but not sign-in pages, the auth API or static files", () => {
    for (const url of ["/", "/search?q=a", "/podcast/1", "/admin", "/settings", "/pending", "/api/analyze", "/api/health"]) {
      expect(runsFor(url), url).toBe(true);
    }
    for (const url of ["/login", "/signup", "/api/auth/sign-in/email", "/_next/static/chunks/a.js", "/icon.svg"]) {
      expect(runsFor(url), url).toBe(false);
    }
  });

  it("answers signed-out API calls with 401", async () => {
    const res = proxy(new NextRequest("http://localhost:3000/api/analyze", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("sends signed-out visitors to sign in, remembering where they were going", () => {
    expect(getRedirectUrl(proxy(new NextRequest("http://localhost:3000/podcast/5?tab=x")))).toBe(
      "http://localhost:3000/login?next=%2Fpodcast%2F5%3Ftab%3Dx",
    );
    expect(getRedirectUrl(proxy(new NextRequest("http://localhost:3000/")))).toBe("http://localhost:3000/login");
  });

  it("lets anyone with a session cookie through (the pages and APIs validate it)", () => {
    const req = new NextRequest("http://localhost:3000/podcast/5", { headers: { cookie: "better-auth.session_token=abc" } });
    expect(getRedirectUrl(proxy(req))).toBeNull();
    expect(proxy(req).status).toBe(200);
  });
});
