import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), listUsers: vi.fn() }));
vi.mock("@/lib/server/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/server/admin", () => ({ listUsers: mocks.listUsers }));

const { GET } = await import("@/app/api/admin/users/route");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listUsers.mockResolvedValue([{ id: "u1" }]);
});

describe("GET /api/admin/users", () => {
  it("is for admins only", async () => {
    mocks.requireAdmin.mockResolvedValue(NextResponse.json({ error: "Admins only" }, { status: 403 }));
    expect((await GET()).status).toBe(403);
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it("lists the accounts", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "admin1", role: "admin", approved: true });
    expect(await (await GET()).json()).toEqual([{ id: "u1" }]);
  });
});
