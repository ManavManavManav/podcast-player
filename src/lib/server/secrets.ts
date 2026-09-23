import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encrypts users' API keys at rest with AES-256-GCM. The key is derived from
 * BETTER_AUTH_SECRET, so changing that secret makes stored API keys
 * unreadable (users would need to enter them again).
 */

const VERSION = "v1";

function encryptionKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be set (at least 32 characters) to store API keys.");
  }
  return Buffer.from(hkdfSync("sha256", secret, "podblock", "podblock-api-keys", 32));
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(":");
}

/** Returns null if the value can't be decrypted (e.g. the secret changed). */
export function decryptSecret(stored: string): string | null {
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "sk-ant-api03-abc…xyz9" → "sk-a…xyz9": enough to recognize, not to use. */
export function maskSecret(secret: string): string {
  return secret.length <= 10 ? "••••" : `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
