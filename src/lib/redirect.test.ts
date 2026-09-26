import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/redirect";

describe("safeNext", () => {
  it.each(["/", "/podcast/1", "/podcast/1?x=y", "/search?q=a%20b#top", "/%5Cevil.com"])("keeps same-site path %s", (next) => {
    expect(safeNext(next)).toBe(next);
  });

  it.each([
    undefined,
    "",
    "podcast/1",
    "//evil.com",
    "/\\evil.com", // browsers treat \ as /, so this is //evil.com
    "/\\/evil.com",
    "\\\\evil.com",
    "/\t/evil.com", // tabs and newlines are stripped by URL parsers
    "/\n/evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/..//evil.com", // normalizes to //evil.com
  ])("falls back to / for %j", (next) => {
    expect(safeNext(next)).toBe("/");
  });

  it("ignores non-string values (e.g. a repeated query parameter)", () => {
    expect(safeNext(["/a", "/b"])).toBe("/");
  });

  it("never produces something a browser resolves off-site", () => {
    for (const next of ["/\\evil.com", "//evil.com", "/\t/evil.com", "/./\\evil.com", "/..//evil.com"]) {
      expect(new URL(safeNext(next), "https://app.example").origin).toBe("https://app.example");
    }
  });
});
