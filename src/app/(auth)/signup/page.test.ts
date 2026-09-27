import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(async () => null), hasAdmin: vi.fn() }));
vi.mock("@/lib/server/session", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/server/auth", () => ({ hasAdmin: mocks.hasAdmin, enabledSocialProviders: [] }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { default: SignupPage } = await import("@/app/(auth)/signup/page");

describe("the sign-up page", () => {
  it("asks for the setup code only until the admin account exists", async () => {
    mocks.hasAdmin.mockResolvedValue(false);
    expect((await SignupPage()).props.setupCode).toBe(true);
    mocks.hasAdmin.mockResolvedValue(true);
    expect((await SignupPage()).props.setupCode).toBe(false);
  });
});
