/**
 * The transcription and ad-detection APIs, configured by the server's owner.
 * Both speak the OpenAI API shape, so any compatible provider works:
 * transcription on Groq or DeepInfra, detection on Xiaomi MiMo, OpenRouter…
 */

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export const DEFAULT_TRANSCRIBE_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
export const DEFAULT_DETECT_BASE_URL = "https://api.xiaomimimo.com/v1";
export const DEFAULT_DETECT_MODEL = "mimo-v2.6-pro";

/** Speech-to-text (OpenAI `/audio/transcriptions`), or null if no key is set. */
export function transcribeConfig(): ApiConfig | null {
  const apiKey = process.env.TRANSCRIBE_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: trimSlash(process.env.TRANSCRIBE_BASE_URL || DEFAULT_TRANSCRIBE_BASE_URL),
    apiKey,
    model: process.env.TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL,
  };
}

/** Ad detection (OpenAI `/chat/completions`), or null if no key is set. */
export function detectConfig(): ApiConfig | null {
  const apiKey = process.env.DETECT_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: trimSlash(process.env.DETECT_BASE_URL || DEFAULT_DETECT_BASE_URL),
    apiKey,
    model: process.env.DETECT_MODEL || DEFAULT_DETECT_MODEL,
  };
}

/** The account that is made admin (and approved) when it signs up. */
export function adminEmail(): string | null {
  return process.env.PODBLOCK_ADMIN_EMAIL?.trim().toLowerCase() || null;
}
