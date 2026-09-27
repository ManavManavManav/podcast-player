// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const signUpEmail = vi.hoisted(() => vi.fn(async () => ({ error: { code: "FORBIDDEN", message: "That setup code isn't right." } })));
vi.mock("@/lib/authClient", () => ({ authClient: { signUp: { email: signUpEmail }, signIn: { email: vi.fn(), social: vi.fn() } } }));

const { AuthForm } = await import("@/components/auth/AuthForm");

afterEach(() => {
  cleanup();
  signUpEmail.mockClear();
});

function fill(extra: Record<string, string> = {}) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Owner" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long enough password" } });
  for (const [label, value] of Object.entries(extra)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);
}

describe("sign-up form", () => {
  it("asks for the setup code when the admin account doesn't exist yet, and sends it", async () => {
    render(<AuthForm mode="signup" next="/" socialProviders={[]} setupCode />);
    fill({ "Setup code": "the-code" });
    await screen.findByText("That setup code isn't right.");
    const [body] = signUpEmail.mock.calls[0] as unknown as [{ email: string; fetchOptions?: { headers: Record<string, string> } }];
    expect(body.email).toBe("owner@example.com");
    expect(body.fetchOptions?.headers["x-podblock-setup-code"]).toBe("the-code");
  });

  it("doesn't mention a setup code otherwise", async () => {
    render(<AuthForm mode="signup" next="/" socialProviders={[]} />);
    expect(screen.queryByLabelText("Setup code")).toBeNull();
    fill();
    await screen.findByText("That setup code isn't right.");
    const [body] = signUpEmail.mock.calls[0] as unknown as [{ fetchOptions?: unknown }];
    expect(body.fetchOptions).toBeUndefined();
  });
});
