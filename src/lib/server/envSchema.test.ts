import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkEnv, ENV_VARS } from "@/lib/server/envSchema.mjs";

const good = {
  BETTER_AUTH_SECRET: "x".repeat(48),
  BETTER_AUTH_URL: "https://podblock.example.com",
  PODBLOCK_ADMIN_EMAIL: "owner@example.com",
  PODCAST_INDEX_API_KEY: "key",
  PODCAST_INDEX_API_SECRET: "secret",
  TRANSCRIBE_API_KEY: "t",
  DETECT_API_KEY: "d",
};
const production = { production: true, vercel: false };
const development = { production: false, vercel: false };

describe("checkEnv", () => {
  it("accepts a complete configuration", () => {
    expect(checkEnv(good, production)).toEqual({ errors: [], warnings: [] });
  });

  it("requires a real auth secret in production", () => {
    expect(checkEnv({ ...good, BETTER_AUTH_SECRET: "" }, production).errors).toEqual([
      expect.stringContaining("BETTER_AUTH_SECRET"),
    ]);
    expect(checkEnv({ ...good, BETTER_AUTH_SECRET: "short" }, production).errors[0]).toMatch(/32/);
    // Development can run on Better Auth's default, with a warning.
    expect(checkEnv({ ...good, BETTER_AUTH_SECRET: "" }, development)).toMatchObject({
      errors: [],
      warnings: [expect.stringContaining("BETTER_AUTH_SECRET")],
    });
  });

  it("requires a hosted database on Vercel", () => {
    expect(checkEnv(good, { production: true, vercel: true }).errors).toEqual([expect.stringContaining("DATABASE_URL")]);
    expect(checkEnv({ ...good, DATABASE_URL: "libsql://db.turso.io", DATABASE_AUTH_TOKEN: "tok" }, { production: true, vercel: true }).errors).toEqual([]);
  });

  it("rejects malformed values", () => {
    const { errors } = checkEnv(
      {
        ...good,
        BETTER_AUTH_URL: "podblock.example.com",
        TRANSCRIBE_BASE_URL: "not a url",
        PODBLOCK_TRUSTED_ORIGINS: "https://ok.example, nope",
        PODBLOCK_ADMIN_EMAIL: "owner",
        PODBLOCK_LOG_LEVEL: "loud",
        DATABASE_URL: "postgres://db",
      },
      production,
    );
    for (const name of ["BETTER_AUTH_URL", "TRANSCRIBE_BASE_URL", "PODBLOCK_TRUSTED_ORIGINS", "PODBLOCK_ADMIN_EMAIL", "PODBLOCK_LOG_LEVEL", "DATABASE_URL"]) {
      expect(errors.join("\n")).toContain(name);
    }
  });

  it("takes dev origins as hostnames, the way Next.js matches them", () => {
    expect(checkEnv({ ...good, DEV_ALLOWED_ORIGINS: "100.92.248.74, *.tunnel.example.com, box.local" }, development).errors).toEqual([]);
    const { warnings } = checkEnv({ ...good, DEV_ALLOWED_ORIGINS: "http://100.92.248.74:3001" }, development);
    expect(warnings.join("\n")).toMatch(/DEV_ALLOWED_ORIGINS.*hostnames/);
  });

  it("warns about what would quietly not work", () => {
    const { errors, warnings } = checkEnv(
      {
        BETTER_AUTH_SECRET: "x".repeat(48),
        GITHUB_CLIENT_ID: "id-only",
        DATABASE_URL: "libsql://db.turso.io",
        PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS: "127.0.0.1:4010",
      },
      production,
    );
    expect(errors).toEqual([]);
    const text = warnings.join("\n");
    for (const name of [
      "BETTER_AUTH_URL",
      "PODBLOCK_ADMIN_EMAIL",
      "PODCAST_INDEX_API_KEY",
      "TRANSCRIBE_API_KEY",
      "DETECT_API_KEY",
      "GITHUB_CLIENT_SECRET",
      "DATABASE_AUTH_TOKEN",
      "PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("accepts the base64 form of the Podcast Index secret", () => {
    expect(checkEnv({ ...good, PODCAST_INDEX_API_SECRET: undefined, PODCAST_INDEX_API_SECRET_BASE64: "c2VjcmV0" }, production).warnings).toEqual([]);
  });

  it("never repeats secret values in its messages", () => {
    const { errors } = checkEnv({ ...good, BETTER_AUTH_SECRET: "tooshort-secret" }, production);
    expect(errors.join("\n")).not.toContain("tooshort-secret");
  });
});

describe("ENV_VARS", () => {
  it("describes every setting the server reads", () => {
    const names = ENV_VARS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    for (const v of ENV_VARS) expect(v.description.length).toBeGreaterThan(10);
  });
});

describe("documentation", () => {
  const read = (file: string) => fs.readFileSync(path.resolve(file), "utf-8");

  it("lists every setting in .env.example", () => {
    const example = read(".env.example");
    const missing = ENV_VARS.filter((v) => !new RegExp(`^#? ?${v.name}=`, "m").test(example)).map((v) => v.name);
    expect(missing).toEqual([]);
  });

  it("describes every non-development setting in the README's configuration table", () => {
    const readme = read("README.md");
    const table = readme.slice(readme.indexOf("## Configuration"), readme.indexOf("## Keyboard shortcuts"));
    const missing = ENV_VARS.filter((v) => v.group !== "development" && !table.includes(v.name)).map((v) => v.name);
    expect(missing).toEqual([]);
  });
});
