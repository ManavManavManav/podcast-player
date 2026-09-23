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

/**
 * Models that always reason before answering and reject `thinking: disabled`
 * (Z.ai: GLM-5.3 models accept only low/high/max effort). Others are added
 * at runtime if Z.ai says so, so a newer model doesn't break detection.
 */
const ALWAYS_THINKS = [/^glm-5\.3/];
const learnedThinkers = new Set<string>();

function alwaysThinks(model: string) {
  return learnedThinkers.has(model) || ALWAYS_THINKS.some((pattern) => pattern.test(model));
}

class ZaiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Z.ai ${status}: ${message}`);
  }
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

  const request = (thinking: boolean) =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_INSTRUCTIONS}` },
          { role: "user", content: formatTranscript(window, context) },
        ],
        // A simple classification: no reasoning where the model allows it,
        // the least it will do otherwise.
        ...(thinking
          ? { thinking: { type: "enabled" }, reasoning_effort: "low" }
          : { thinking: { type: "disabled" } }),
        temperature: 0.2,
        // Reasoning counts toward output tokens; leave room for the answer.
        max_tokens: thinking ? 4096 : 1024,
        ...(supportsJsonMode(model) ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
    }).then(async (res) => {
      const body = (await res.json().catch(() => ({}))) as ChatResponse;
      if (!res.ok) throw new ZaiError(res.status, body.error?.message ?? res.statusText);
      return body;
    });

  let body: ChatResponse;
  try {
    body = await request(alwaysThinks(model));
  } catch (err) {
    // "This model always engages in thinking and cannot be disabled"
    const cannotDisable =
      err instanceof ZaiError && err.status === 400 && /thinking/i.test(err.message) && !alwaysThinks(model);
    if (!cannotDisable) throw err;
    learnedThinkers.add(model);
    body = await request(true);
  }

  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error("Z.ai returned an empty answer");
  return parseAds(text, window);
}
