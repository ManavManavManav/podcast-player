import Anthropic from "@anthropic-ai/sdk";
import type { AdRange, TranscriptSegment } from "@/lib/types";

/**
 * Optional LLM ad classifier. Enabled when ANTHROPIC_API_KEY is set (or
 * AD_DETECTOR=claude). Each transcript window is classified with the previous
 * window as context, so an ad that straddles a window boundary is recognized
 * on both sides.
 */

export const claudeModel = process.env.CLAUDE_MODEL || "claude-opus-5";

export function claudeEnabled(): boolean {
  const mode = process.env.AD_DETECTOR?.toLowerCase();
  if (mode === "heuristic") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) || mode === "claude";
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return client;
}

const SYSTEM_PROMPT = `You find advertisements in podcast transcripts so a player can skip them.

Count as an ad: sponsor reads by the hosts, dynamically inserted commercials, promos for other podcasts or shows, and "support for this show comes from" style credits, including the lead-in sentence that introduces the sponsor.
Not an ad: the show's own content, the hosts talking about a product as part of the discussion, or plugs for the show's own newsletter, Patreon or social accounts that are shorter than a sentence or two.

You receive timestamped transcript lines. Lines marked CONTEXT come from just before the window and are for reference only: never report a range that starts before the first WINDOW line. Report each ad as start/end times in seconds taken from the line timestamps, covering the whole ad from its first line to its last. If an ad runs to the end of the window, end it at the last line's end time. If there are no ads, return an empty list.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          advertiser: { type: "string", description: "Brand or show being advertised" },
        },
        required: ["start", "end", "advertiser"],
        additionalProperties: false,
      },
    },
  },
  required: ["ads"],
  additionalProperties: false,
} as const;

function formatLines(segments: TranscriptSegment[], tag: string) {
  return segments
    .map((s) => `${tag} [${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n");
}

export async function classifyWindow(
  window: TranscriptSegment[],
  context: TranscriptSegment[],
  signal?: AbortSignal,
): Promise<AdRange[]> {
  if (window.length === 0) return [];
  const windowStart = window[0].start;
  const windowEnd = window.at(-1)!.end;

  const transcript = [formatLines(context.slice(-12), "CONTEXT"), formatLines(window, "WINDOW")]
    .filter(Boolean)
    .join("\n");

  const isOpus5 = /^claude-(opus-5|fable)/.test(claudeModel);
  const response = await getClient().beta.messages.create(
    {
      model: claudeModel,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: transcript }],
      output_config: {
        // Short classification: little reasoning needed.
        ...(/haiku/.test(claudeModel) ? {} : { effort: "low" as const }),
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      // Re-run on a fallback model if a safety classifier declines.
      ...(isOpus5 ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming,
    { signal },
  );

  if (response.stop_reason === "refusal") return [];
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) return [];

  let parsed: { ads?: Array<{ start: number; end: number; advertiser?: string }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Claude returned malformed JSON");
  }

  return (parsed.ads ?? [])
    .map((ad) => ({
      start: Math.max(windowStart, Number(ad.start)),
      end: Math.min(windowEnd, Number(ad.end)),
      confidence: 0.9,
      reason: ad.advertiser ? `Ad: ${ad.advertiser}` : "Ad",
    }))
    .filter((ad) => Number.isFinite(ad.start) && Number.isFinite(ad.end) && ad.end - ad.start >= 3);
}
