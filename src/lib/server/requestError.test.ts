import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logRequestError } from "@/lib/server/requestError";

let lines: Array<Record<string, unknown>>;
beforeEach(() => {
  lines = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => lines.push(JSON.parse(line)));
  vi.stubEnv("PODBLOCK_LOG_LEVEL", "info");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("logRequestError", () => {
  it("logs the error with the digest the error page shows, and where it happened", () => {
    const err = Object.assign(new Error("Podcast Index request failed (401)"), { digest: "2594822162" });
    logRequestError(
      err,
      { path: "/podcast/1?x=1", method: "GET", headers: { "x-request-id": "req-9", cookie: "better-auth.session_token=secret" } },
      { routerKind: "App Router", routePath: "/(app)/podcast/[id]", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined },
    );
    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        event: "request.error",
        digest: "2594822162",
        method: "GET",
        path: "/podcast/1?x=1",
        route: "/(app)/podcast/[id]",
        routeType: "render",
        requestId: "req-9",
        err: expect.objectContaining({ message: "Podcast Index request failed (401)" }),
      }),
    ]);
    // Request headers (cookies) aren't logged.
    expect(JSON.stringify(lines)).not.toContain("session_token");
  });

  it("copes with things thrown that aren't errors", () => {
    logRequestError("just a string", { path: "/", method: "GET", headers: {} }, { routerKind: "App Router", routePath: "/", routeType: "route", revalidateReason: undefined });
    expect(lines[0]).toMatchObject({ event: "request.error", err: "just a string" });
  });
});
