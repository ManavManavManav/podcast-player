import type { AdRange, EpisodeContext, TranscriptSegment } from "@/lib/types";
import type { ApiConfig } from "@/lib/server/config";
import { AppError } from "@/lib/server/errors";
import { fetchWithRetry } from "@/lib/server/retry";
import { JSON_INSTRUCTIONS, SYSTEM_PROMPT, formatTranscript, parseAds } from "@/lib/server/llm/prompt";

const TIMEOUT_MS = 90_000;

/**
 * Models whose API rejected the extras below (reasoning switch, JSON mode),
 * learned at runtime, so they're only tried once per server process.
 */
const plainOnly = new Set<string>();

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

export interface Detection {
  ads: AdRange[];
  inputTokens: number;
  outputTokens: number;
}

class ApiError extends AppError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super("detection", `Ad detection failed (${status}): ${message}`);
  }
}

/**
 * Finds the ads in one transcript window with an OpenAI-compatible chat model
 * (built for Xiaomi MiMo; any compatible API works). The end of the previous
 * window is included as context, so an ad that straddles the boundary is
 * recognized on both sides.
 */
export async function detectAds(
  window: TranscriptSegment[],
  context: TranscriptSegment[],
  episode: EpisodeContext,
  config: ApiConfig,
  signal?: AbortSignal,
): Promise<Detection> {
  if (window.length === 0) return { ads: [], inputTokens: 0, outputTokens: 0 };

  const request = async (plain: boolean): Promise<ChatResponse> => {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const send = () => fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_INSTRUCTIONS}` },
          { role: "user", content: formatTranscript(window, context, episode) },
        ],
        temperature: 0.2,
        ...(plain
          ? { max_tokens: 2048 }
          : {
              // A simple classification: reasoning only adds cost and delay.
              thinking: { type: "disabled" },
              response_format: { type: "json_object" },
              max_completion_tokens: 2048,
            }),
      }),
      signal: combined,
    });
    const res = await fetchWithRetry(send, { signal: combined, label: "detection" });
    const body = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok) {
      const message = typeof body.error === "string" ? body.error : body.error?.message;
      throw new ApiError(res.status, message ?? res.statusText);
    }
    return body;
  };

  let body: ChatResponse;
  if (plainOnly.has(config.model)) {
    body = await request(true);
  } else {
    try {
      body = await request(false);
    } catch (err) {
      // An API that doesn't know one of the extras rejects the request as a
      // whole; ask again without them.
      if (!(err instanceof ApiError) || (err.status !== 400 && err.status !== 422)) throw err;
      body = await request(true);
      plainOnly.add(config.model);
    }
  }

  const text = body.choices?.[0]?.message?.content;
  if (!text) {
    throw new AppError(
      "detection",
      body.choices?.[0]?.finish_reason === "length"
        ? "The model ran out of tokens before answering"
        : "The model returned an empty answer",
    );
  }
  return {
    ads: parseAds(text, window),
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}
