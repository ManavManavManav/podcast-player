import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), getAuth: vi.fn(), getSession: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/server/auth", () => ({ getAuth: mocks.getAuth }));

const { currentUser, requireAdmin, requireUser } = await import("@/lib/server/session");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ cookie: "x=1" }));
  mocks.getAuth.mockResolvedValue({ api: { getSession: mocks.getSession } });
});

const sessionFor = (user: object) => ({ user: { id: "u1", name: "U", email: "u@example.com", image: null, ...user } });

describe("currentUser", () => {
  it("doesn't start auth (database, migrations) before there's a request", async () => {
    // While prerendering at build time, reading headers throws to mark the page dynamic.
    const bailout = new Error("Dynamic server usage: headers");
    mocks.headers.mockRejectedValue(bailout);
    await expect(currentUser()).rejects.toBe(bailout);
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });

  it("returns null without a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect(await currentUser()).toBeNull();
  });

  it("treats the admin as approved and anything else as a plain user", async () => {
    mocks.getSession.mockResolvedValue(sessionFor({ role: "admin", approved: false }));
    expect(await currentUser()).toMatchObject({ role: "admin", approved: true });
    mocks.getSession.mockResolvedValue(sessionFor({ role: "superuser", approved: true }));
    expect(await currentUser()).toMatchObject({ role: "user", approved: true });
  });
});

describe("requireUser / requireAdmin", () => {
  it("refuses signed-out, unapproved and non-admin users", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect(((await requireUser()) as Response).status).toBe(401);
    mocks.getSession.mockResolvedValue(sessionFor({ role: "user", approved: false }));
    expect(((await requireUser()) as Response).status).toBe(403);
    mocks.getSession.mockResolvedValue(sessionFor({ role: "user", approved: true }));
    expect(await requireUser()).toMatchObject({ id: "u1" });
    expect(((await requireAdmin()) as Response).status).toBe(403);
    mocks.getSession.mockResolvedValue(sessionFor({ role: "admin" }));
    expect(await requireAdmin()).toMatchObject({ role: "admin" });
  });
});

describe("fresh checks", () => {
  it("skip the session cookie cache only when asked", async () => {
    mocks.getSession.mockResolvedValue(sessionFor({ role: "user", approved: true }));
    await currentUser();
    expect(mocks.getSession.mock.calls[0][0].query).toBeUndefined();
    await currentUser({ fresh: true });
    expect(mocks.getSession.mock.calls[1][0].query).toEqual({ disableCookieCache: true });
  });

  it("are what admin gating uses", async () => {
    mocks.getSession.mockResolvedValue(sessionFor({ role: "admin" }));
    await requireAdmin();
    expect(mocks.getSession.mock.calls.at(-1)?.[0].query).toEqual({ disableCookieCache: true });
  });

  it("re-check a cached 'waiting for approval', so a new approval never bounces between pages", async () => {
    mocks.getSession
      .mockResolvedValueOnce(sessionFor({ role: "user", approved: false })) // from the cookie cache
      .mockResolvedValueOnce(sessionFor({ role: "user", approved: true })); // from the database
    expect(await currentUser()).toMatchObject({ approved: true });
    expect(mocks.getSession.mock.calls.at(-1)?.[0].query).toEqual({ disableCookieCache: true });
  });
});
