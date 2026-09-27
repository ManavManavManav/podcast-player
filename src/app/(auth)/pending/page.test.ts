import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`redirect ${to}`); }) }));
vi.mock("@/lib/server/session", () => ({ currentUser: mocks.currentUser }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const { default: PendingPage } = await import("@/app/(auth)/pending/page");

describe("the pending page", () => {
  it("checks approval against the database, so an approval shows at once", async () => {
    mocks.currentUser.mockResolvedValue({ id: "u", email: "u@example.com", role: "user", approved: true });
    await expect(PendingPage()).rejects.toThrow("redirect /");
    expect(mocks.currentUser).toHaveBeenCalledWith({ fresh: true });
  });
});
