import type { AdRange, TranscriptSegment } from "@/lib/types";
import { JSON_INSTRUCTIONS, SYSTEM_PROMPT, formatTranscript, parseAds } from "@/lib/server/llm/prompt";

/** Free on Z.ai's API (rate-limited). */
export const DEFAULT_GLM_MODEL = "glm-4.7-flash";

const ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";

/**
 * Z.ai lists some GLM "flash" models as vision models, and JSON mode
 * (`response_format`) only applies to text models, so it's only requested
 * where it's supported; the answer is parsed tolerantly either way.
 */
const VISION_MODELS = [
  /^glm-5\.3-flashx?$/, // glm-5.3-flash, glm-5.3-flashx
  /^glm-[\d.]+v(-flashx?)?$/, // glm-4.6v, glm-4.6v-flash, glm-4.5v…
];
export function supportsJsonMode(model: string) {
  return !VISION_MODELS.some((pattern) => pattern.test(model));
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/** Classifies one transcript window with a GLM model via Z.ai's API. */
export async function classifyWithGlm(
  window: TranscriptSegment[],
  context: TranscriptSegment[],
  { apiKey, model }: { apiKey: string; model: string },
  signal?: AbortSignal,
): Promise<AdRange[]> {
  if (window.length === 0) return [];

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_INSTRUCTIONS}` },
        { role: "user", content: formatTranscript(window, context) },
      ],
      // A yes/no classification: no reasoning, low randomness.
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 1024,
      ...(supportsJsonMode(model) ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });

  const body = (await res.json().catch(() => ({}))) as ChatResponse;
  if (!res.ok) {
    throw new Error(`Z.ai ${res.status}: ${body.error?.message ?? res.statusText}`);
  }
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error("Z.ai returned an empty answer");
  return parseAds(text, window);
}
