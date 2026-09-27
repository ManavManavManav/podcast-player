import { describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => vi.fn(async (req: Request) => new Response(`${req.method} handled`)));
vi.mock("@/lib/server/auth", () => ({ getAuth: async () => ({ handler }) }));

const { GET, POST } = await import("@/app/api/auth/[...all]/route");

describe("/api/auth/*", () => {
  it("hands every GET and POST to Better Auth", async () => {
    expect(await (await GET(new Request("http://localhost:3000/api/auth/get-session"))).text()).toBe("GET handled");
    expect(await (await POST(new Request("http://localhost:3000/api/auth/sign-out", { method: "POST" }))).text()).toBe(
      "POST handled",
    );
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
