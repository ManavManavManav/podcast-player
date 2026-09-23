import { getDb } from "@/lib/server/db";
import { DEFAULT_CLAUDE_MODEL } from "@/lib/server/llm/claude";
import { DEFAULT_GLM_MODEL } from "@/lib/server/llm/glm";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/server/secrets";
import type { DetectorKind, UserSettings } from "@/lib/types";

/** What the analyzer needs to run the detector a user picked. */
export type DetectorConfig =
  | { kind: "heuristic" }
  | { kind: "claude" | "glm"; model: string; apiKey: string };

interface Row {
  detector: string;
  glm_model: string | null;
  claude_model: string | null;
  zai_key: string | null;
  anthropic_key: string | null;
}

const DETECTORS: DetectorKind[] = ["heuristic", "glm", "claude"];

function readRow(userId: string): Row | undefined {
  return getDb()
    .prepare("SELECT detector, glm_model, claude_model, zai_key, anthropic_key FROM user_settings WHERE user_id = ?")
    .get(userId) as Row | undefined;
}

/**
 * Server-wide keys from the environment, used by anyone who hasn't added
 * their own. Usage is billed to whoever owns them (the server's operator).
 */
function sharedKey(provider: "zai" | "anthropic"): string | null {
  return (provider === "zai" ? process.env.ZAI_API_KEY : process.env.ANTHROPIC_API_KEY) || null;
}

function key(row: Row | undefined, provider: "zai" | "anthropic"): { value: string | null; own: boolean; broken: boolean } {
  const stored = provider === "zai" ? row?.zai_key : row?.anthropic_key;
  if (stored) {
    const value = decryptSecret(stored);
    return { value, own: true, broken: value === null };
  }
  return { value: sharedKey(provider), own: false, broken: false };
}

/** Settings as shown to the user: keys masked, never in full. */
export function getSettings(userId: string): UserSettings {
  const row = readRow(userId);
  const zai = key(row, "zai");
  const anthropic = key(row, "anthropic");
  const describe = (k: typeof zai) =>
    k.broken
      ? { status: "unreadable" as const }
      : k.own && k.value
        ? { status: "own" as const, masked: maskSecret(k.value) }
        : k.value
          ? { status: "shared" as const }
          : { status: "none" as const };

  return {
    detector: DETECTORS.includes(row?.detector as DetectorKind) ? (row!.detector as DetectorKind) : "heuristic",
    glmModel: row?.glm_model || DEFAULT_GLM_MODEL,
    claudeModel: row?.claude_model || DEFAULT_CLAUDE_MODEL,
    keys: { zai: describe(zai), anthropic: describe(anthropic) },
  };
}

export interface SettingsUpdate {
  detector?: DetectorKind;
  glmModel?: string;
  claudeModel?: string;
  /** A new key, or null to remove the stored one. Omit to leave unchanged. */
  zaiKey?: string | null;
  anthropicKey?: string | null;
}

const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/i;

export function validateUpdate(input: unknown): SettingsUpdate | string {
  if (!input || typeof input !== "object") return "Expected an object";
  const body = input as Record<string, unknown>;
  const update: SettingsUpdate = {};

  if (body.detector !== undefined) {
    if (!DETECTORS.includes(body.detector as DetectorKind)) return "Unknown detector";
    update.detector = body.detector as DetectorKind;
  }
  for (const field of ["glmModel", "claudeModel"] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || !MODEL_PATTERN.test(body[field] as string)) return `Invalid ${field}`;
    update[field] = body[field] as string;
  }
  for (const field of ["zaiKey", "anthropicKey"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (value === null) {
      update[field] = null;
      continue;
    }
    if (typeof value !== "string" || value.trim().length < 8 || value.length > 500 || /\s/.test(value.trim())) {
      return `That doesn't look like a valid ${field === "zaiKey" ? "Z.ai" : "Anthropic"} API key`;
    }
    update[field] = value.trim();
  }
  return update;
}

export function saveSettings(userId: string, update: SettingsUpdate): UserSettings {
  const row = readRow(userId);
  const encrypt = (value: string | null | undefined, current: string | null | undefined) =>
    value === undefined ? (current ?? null) : value === null ? null : encryptSecret(value);

  getDb().prepare(
    `INSERT INTO user_settings (user_id, detector, glm_model, claude_model, zai_key, anthropic_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       detector = excluded.detector, glm_model = excluded.glm_model, claude_model = excluded.claude_model,
       zai_key = excluded.zai_key, anthropic_key = excluded.anthropic_key, updated_at = excluded.updated_at`,
  ).run(
    userId,
    update.detector ?? row?.detector ?? "heuristic",
    update.glmModel ?? row?.glm_model ?? null,
    update.claudeModel ?? row?.claude_model ?? null,
    encrypt(update.zaiKey, row?.zai_key),
    encrypt(update.anthropicKey, row?.anthropic_key),
    Date.now(),
  );
  return getSettings(userId);
}

/**
 * The detector to run for a user. Falls back to the on-device one when the
 * chosen provider has no usable key.
 */
export function detectorFor(userId: string): DetectorConfig {
  const settings = getSettings(userId);
  const row = readRow(userId);
  if (settings.detector === "glm") {
    const apiKey = key(row, "zai").value;
    if (apiKey) return { kind: "glm", model: settings.glmModel, apiKey };
  }
  if (settings.detector === "claude") {
    const apiKey = key(row, "anthropic").value;
    if (apiKey) return { kind: "claude", model: settings.claudeModel, apiKey };
  }
  return { kind: "heuristic" };
}

export function deleteSettings(userId: string) {
  getDb().prepare("DELETE FROM user_settings WHERE user_id = ?").run(userId);
}
