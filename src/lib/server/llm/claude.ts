import Anthropic from "@anthropic-ai/sdk";
import type { AdRange, TranscriptSegment } from "@/lib/types";
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, formatTranscript, parseAds } from "@/lib/server/llm/prompt";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";

/** One client per API key, so users' keys never mix. */
const clients = new Map<string, Anthropic>();
function clientFor(apiKey: string) {
  let client = clients.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
    clients.set(apiKey, client);
    if (clients.size > 50) clients.delete(clients.keys().next().value!);
  }
  return client;
}

/**
 * Classifies one transcript window with Claude. The previous window is
 * included as context so an ad that straddles a boundary is recognized on
 * both sides.
 */
export async function classifyWithClaude(
  window: TranscriptSegment[],
  context: TranscriptSegment[],
  { apiKey, model }: { apiKey: string; model: string },
  signal?: AbortSignal,
): Promise<AdRange[]> {
  if (window.length === 0) return [];

  const isOpus5 = /^claude-(opus-5|fable)/.test(model);
  const response = await clientFor(apiKey).beta.messages.create(
    {
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: formatTranscript(window, context) }],
      output_config: {
        // Short classification: little reasoning needed.
        ...(/haiku/.test(model) ? {} : { effort: "low" as const }),
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      // Re-run on a fallback model if a safety classifier declines.
      ...(isOpus5 ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming,
    { signal },
  );

  if (response.stop_reason === "refusal") return [];
  const text = response.content.find((b) => b.type === "text")?.text;
  return text ? parseAds(text, window) : [];
}
