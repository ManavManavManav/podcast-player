import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/securityHeaders";

function header(headers: Array<{ key: string; value: string }>, key: string) {
  return headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

function directives(csp: string | undefined): Record<string, string[]> {
  return Object.fromEntries(
    (csp ?? "")
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name, values]),
  );
}

describe("securityHeaders", () => {
  const prod = securityHeaders({ dev: false });
  const dev = securityHeaders({ dev: true });

  it("refuses to be framed (clickjacking)", () => {
    expect(header(prod, "X-Frame-Options")).toBe("DENY");
  });

  it("sets the basic hardening headers", () => {
    expect(header(prod, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(prod, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(prod, "Permissions-Policy")).toMatch(/camera=\(\)/);
    expect(header(prod, "Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("asks browsers to stay on HTTPS in production only", () => {
    expect(header(prod, "Strict-Transport-Security")).toMatch(/max-age=\d{7,}/);
    expect(header(dev, "Strict-Transport-Security")).toBeUndefined();
  });

  it("enforces the content security policy", () => {
    expect(header(prod, "Content-Security-Policy")).toBeTruthy();
    expect(header(prod, "Content-Security-Policy-Report-Only")).toBeUndefined();
  });

  it("has a content security policy that still lets the player work", () => {
    const csp = directives(header(prod, "Content-Security-Policy"));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    // All API calls are same-origin.
    expect(csp["connect-src"]).toEqual(["'self'"]);
    // Episode audio and artwork come from any podcast host.
    expect(csp["media-src"]).toContain("https:");
    expect(csp["media-src"]).toContain("http:");
    expect(csp["img-src"]).toContain("https:");
    // eval is only for React's development tooling.
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("allows eval in development only", () => {
    const csp = directives(header(dev, "Content-Security-Policy"));
    expect(csp["script-src"]).toContain("'unsafe-eval'");
  });
});
