import { APIError } from "better-auth/api";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listUsers: vi.fn(),
  approveUser: vi.fn(),
  deleteUsage: vi.fn(),
  api: { banUser: vi.fn(), unbanUser: vi.fn(), removeUser: vi.fn(), setUserPassword: vi.fn() },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/server/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/server/admin", () => ({ listUsers: mocks.listUsers, approveUser: mocks.approveUser }));
vi.mock("@/lib/server/usage", () => ({ deleteUsage: mocks.deleteUsage }));
vi.mock("@/lib/server/auth", () => ({ getAuth: async () => ({ api: mocks.api }) }));

const { POST } = await import("@/app/api/admin/users/[id]/route");

const admin = { id: "admin1", name: "A", email: "a@example.com", role: "admin", approved: true };
const users = [
  { id: "admin1", email: "a@example.com" },
  { id: "u2", email: "b@example.com" },
];

function call(id: string, body: unknown, headers: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost:3000/api/admin/users/${id}`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(admin);
  mocks.listUsers.mockResolvedValue(users);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("PODBLOCK_LOG_LEVEL", "info");
});

describe("POST /api/admin/users/[id]", () => {
  it("refuses cross-site requests and non-admins", async () => {
    expect((await call("u2", { action: "approve" }, { origin: "https://evil.example" })).status).toBe(403);
    mocks.requireAdmin.mockResolvedValue(NextResponse.json({ error: "Admins only" }, { status: 403 }));
    expect((await call("u2", { action: "approve" })).status).toBe(403);
    expect(mocks.approveUser).not.toHaveBeenCalled();
  });

  it("rejects unknown actions, actions on yourself, and unknown users", async () => {
    expect((await call("u2", { action: "promote" })).status).toBe(400);
    expect((await call("admin1", { action: "delete" })).status).toBe(400);
    expect((await call("nobody", { action: "approve" })).status).toBe(404);
  });

  it("approves, disables, enables and deletes, returning the updated list", async () => {
    const approved = await call("u2", { action: "approve" });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual(users);
    expect(mocks.approveUser).toHaveBeenCalledWith("u2");

    await call("u2", { action: "disable" });
    expect(mocks.api.banUser).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ userId: "u2" }) }));
    await call("u2", { action: "enable" });
    expect(mocks.api.unbanUser).toHaveBeenCalled();
    await call("u2", { action: "delete" });
    expect(mocks.api.removeUser).toHaveBeenCalled();
    expect(mocks.deleteUsage).toHaveBeenCalledWith("u2");
  });

  it("sets passwords of 10 to 128 characters only", async () => {
    expect((await call("u2", { action: "set-password", password: "short" })).status).toBe(400);
    expect((await call("u2", { action: "set-password", password: "x".repeat(129) })).status).toBe(400);
    expect((await call("u2", { action: "set-password", password: "a-good-password" })).status).toBe(200);
    expect(mocks.api.setUserPassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { userId: "u2", newPassword: "a-good-password" } }),
    );
  });

  it("passes on Better Auth's own explanations", async () => {
    mocks.api.banUser.mockRejectedValue(new APIError("BAD_REQUEST", { message: "You cannot ban yourself" }));
    const res = await call("u2", { action: "disable" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("You cannot ban yourself");
  });

  it("doesn't show internal errors (e.g. database messages)", async () => {
    mocks.api.removeUser.mockRejectedValue(new Error("SQLITE_BUSY: database is locked (/srv/podblock/.data/podblock.db)"));
    const res = await call("u2", { action: "delete" });
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).not.toMatch(/SQLITE|\.data/);
    expect(vi.mocked(console.error).mock.calls.flat().map(String).join(" ")).toMatch(/SQLITE_BUSY/);
  });

  it("keeps an audit trail of what the admin did", async () => {
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});
    await call("u2", { action: "approve" });
    await call("u2", { action: "set-password", password: "a-good-password" });
    const audit = lines.mock.calls.map(([line]) => JSON.parse(String(line))).filter((e) => e.event === "admin.action");
    expect(audit).toEqual([
      expect.objectContaining({ adminId: "admin1", action: "approve", targetId: "u2", targetEmail: "b@example.com", ok: true }),
      expect.objectContaining({ action: "set-password", ok: true }),
    ]);
    // The password itself is never logged.
    expect(JSON.stringify(lines.mock.calls)).not.toContain("a-good-password");
  });
});
