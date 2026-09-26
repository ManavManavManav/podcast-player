import type { AdRange, EpisodeContext, TranscriptSegment } from "@/lib/types";

/** Instructions and parsing shared by every LLM ad classifier. */

/**
 * Part of the verdict cache key: changing the instructions below should bump
 * it, so verdicts from the old instructions are redone rather than reused.
 */
export const PROMPT_VERSION = 3;

export const SYSTEM_PROMPT = `You find advertisements in podcast transcripts so a player can skip them.

An ad promotes a sponsor's product or service. Count as an ad: sponsor reads by the hosts ("this episode is brought to you by…", "thanks to our partner…"), dynamically inserted commercials, promos for other podcasts or shows, and "support for this show comes from" credits, including the lead-in sentence that introduces the sponsor.

Not an ad:
- Brands, products or companies the hosts discuss as part of the conversation. This especially includes the episode's own subject: an episode about a company will mention it constantly, and none of that is an ad.
- The show's own plugs: its website, newsletter, email list, Slack or Discord, merch, companion material, Patreon or social accounts.
- The show's own disclaimers, such as "this is not investment advice".

When you're unsure, don't flag it: a missed ad costs the listener a few seconds, but skipping real content is worse.

You receive timestamped transcript lines. Lines marked CONTEXT come from just before the window and are for reference only: never report a range that starts before the first WINDOW line. Report each ad as start/end times in seconds taken from the line timestamps, covering the whole ad from its first line to its last. If an ad runs to the end of the window, end it at the last line's end time. If there are no ads, return an empty list.`;

/** Appended for providers without enforced structured output. */
export const JSON_INSTRUCTIONS = `Reply with only a JSON object, no other text, in exactly this shape:
{"ads": [{"start": <seconds>, "end": <seconds>, "advertiser": "<brand or show>"}]}`;

export const OUTPUT_SCHEMA = {
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

/** How much of the previous window is sent as context. */
const CONTEXT_LINES = 12;

export function formatTranscript(
  window: TranscriptSegment[],
  context: TranscriptSegment[],
  episode: EpisodeContext = {},
): string {
  const lines = (segments: TranscriptSegment[], tag: string) =>
    segments.map((s) => `${tag} [${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n");
  const about = [
    episode.podcastTitle && `Podcast: ${episode.podcastTitle}`,
    episode.episodeTitle && `Episode: ${episode.episodeTitle}`,
    episode.website && `Show website: ${episode.website}`,
  ].filter(Boolean);
  return [
    about.length ? `${about.join("\n")}\n` : "",
    lines(context.slice(-CONTEXT_LINES), "CONTEXT"),
    lines(window, "WINDOW"),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Parses a model's answer into ad ranges clamped to the window. Tolerates
 * code fences or chatter around the JSON; throws if there's no JSON at all,
 * so the window is retried rather than recorded as ad-free.
 */
export function parseAds(text: string, window: TranscriptSegment[]): AdRange[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model didn't return JSON");

  let parsed: { ads?: Array<{ start: unknown; end: unknown; advertiser?: unknown }> };
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The model returned malformed JSON");
  }

  const windowStart = window[0].start;
  const windowEnd = window.at(-1)!.end;
  return (Array.isArray(parsed.ads) ? parsed.ads : [])
    .map((ad) => ({
      start: Math.max(windowStart, Number(ad.start)),
      end: Math.min(windowEnd, Number(ad.end)),
      confidence: 0.9,
      reason: typeof ad.advertiser === "string" && ad.advertiser ? `Ad: ${ad.advertiser}` : "Ad",
    }))
    .filter((ad) => Number.isFinite(ad.start) && Number.isFinite(ad.end) && ad.end - ad.start >= 3);
}
