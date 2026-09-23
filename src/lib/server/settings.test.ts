import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-test-"));
vi.stubEnv("PODBLOCK_DATA_DIR", dir);
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-that-is-long-enough-0123456789");
vi.stubEnv("ZAI_API_KEY", "");
vi.stubEnv("ANTHROPIC_API_KEY", "");

let settings: typeof import("@/lib/server/settings");
let secrets: typeof import("@/lib/server/secrets");
let db: typeof import("@/lib/server/db");
beforeAll(async () => {
  settings = await import("@/lib/server/settings");
  secrets = await import("@/lib/server/secrets");
  db = await import("@/lib/server/db");
});

describe("secrets", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = secrets.encryptSecret("sk-live-abcdef123456");
    const b = secrets.encryptSecret("sk-live-abcdef123456");
    expect(a).not.toBe(b);
    expect(a).not.toContain("abcdef");
    expect(secrets.decryptSecret(a)).toBe("sk-live-abcdef123456");
  });

  it("returns null for tampered values", () => {
    const stored = secrets.encryptSecret("sk-live-abcdef123456");
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(secrets.decryptSecret(parts.join(":"))).toBeNull();
  });

  it("masks keys", () => {
    expect(secrets.maskSecret("sk-ant-api03-verylongkey9xyz")).toBe("sk-a…9xyz");
    expect(secrets.maskSecret("short")).toBe("••••");
  });
});

describe("user settings", () => {
  it("defaults to on-device detection with no keys", () => {
    expect(settings.getSettings("nobody")).toMatchObject({
      detector: "heuristic",
      glmModel: "glm-4.7-flash",
      keys: { zai: { status: "none" }, anthropic: { status: "none" } },
    });
    expect(settings.detectorFor("nobody")).toEqual({ kind: "heuristic" });
  });

  it("stores keys encrypted, returns them masked, and uses them for detection", () => {
    const saved = settings.saveSettings("u1", { detector: "glm", zaiKey: "zai-secret-key-12345678" });
    expect(saved.keys.zai).toEqual({ status: "own", masked: "zai-…5678" });
    expect(JSON.stringify(saved)).not.toContain("secret-key");

    const row = db.getDb().prepare("SELECT zai_key FROM user_settings WHERE user_id = 'u1'").get() as { zai_key: string };
    expect(row.zai_key).not.toContain("zai-secret");

    expect(settings.detectorFor("u1")).toEqual({ kind: "glm", model: "glm-4.7-flash", apiKey: "zai-secret-key-12345678" });
  });

  it("keeps users' keys separate", () => {
    settings.saveSettings("u2", { detector: "glm" });
    expect(settings.detectorFor("u2")).toEqual({ kind: "heuristic" });
  });

  it("leaves a key alone when omitted and removes it when null", () => {
    settings.saveSettings("u1", { glmModel: "glm-5.3-flash" });
    expect(settings.detectorFor("u1")).toMatchObject({ model: "glm-5.3-flash", apiKey: "zai-secret-key-12345678" });
    settings.saveSettings("u1", { zaiKey: null });
    expect(settings.getSettings("u1").keys.zai).toEqual({ status: "none" });
  });

  it("falls back to a server-wide key when the user has none", () => {
    vi.stubEnv("ZAI_API_KEY", "server-owned-zai-key");
    expect(settings.getSettings("u2").keys.zai).toEqual({ status: "shared" });
    expect(settings.detectorFor("u2")).toMatchObject({ kind: "glm", apiKey: "server-owned-zai-key" });
    vi.stubEnv("ZAI_API_KEY", "");
  });

  it("validates updates", () => {
    expect(settings.validateUpdate({ detector: "gpt" })).toBe("Unknown detector");
    expect(settings.validateUpdate({ glmModel: "../../etc" })).toBe("Invalid glmModel");
    expect(settings.validateUpdate({ zaiKey: "has spaces in it" })).toMatch(/valid Z.ai/);
    expect(settings.validateUpdate({ anthropicKey: "  sk-ant-123456789 " })).toEqual({ anthropicKey: "sk-ant-123456789" });
  });
});
