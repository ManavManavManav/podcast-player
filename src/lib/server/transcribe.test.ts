import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors";
import { parseTranscription, transcribe } from "@/lib/server/transcribe";

const config = { baseUrl: "https://stt.example/v1", apiKey: "sk-test", model: "whisper-large-v3-turbo" };

afterEach(() => vi.unstubAllGlobals());

describe("parseTranscription", () => {
  it("shifts segments into episode time and clamps them to the window", () => {
    const segments = parseTranscription(
      {
        segments: [
          { start: 0, end: 4.2, text: " Welcome back. " },
          { start: 298.5, end: 301.7, text: "Cut off at the edge" },
        ],
      },
      600,
      300,
    );
    expect(segments).toEqual([
      { start: 600, end: 604.2, text: "Welcome back." },
      { start: 898.5, end: 900, text: "Cut off at the edge" },
    ]);
  });

  it("drops silence, empty text and malformed segments", () => {
    const segments = parseTranscription(
      {
        segments: [
          { start: 0, end: 3, text: "Thanks for watching!", no_speech_prob: 0.95 },
          { start: 3, end: 5, text: "   " },
          { start: 5, text: "no end" },
          { start: 6, end: 8, text: "Real speech", no_speech_prob: 0.1 },
        ],
      },
      0,
      300,
    );
    expect(segments.map((s) => s.text)).toEqual(["Real speech"]);
  });
});

describe("transcribe", () => {
  it("posts the audio with segment timestamps requested", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ duration: 300, segments: [{ start: 1, end: 2, text: "Hi" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribe(Buffer.from("flac"), 300, 300, "en", config);
    expect(result).toEqual({ segments: [{ start: 301, end: 302, text: "Hi" }], audioSeconds: 300 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://stt.example/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const form = init.body as FormData;
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("timestamp_granularities[]")).toBe("segment");
    expect(form.get("language")).toBe("en");
  });

  it("reports API errors with the provider's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Invalid API Key" } }, { status: 401 })));
    await expect(transcribe(Buffer.from("x"), 0, 300, undefined, config)).rejects.toThrow(
      "Transcription failed (401): Invalid API Key",
    );
  });

  it("refuses responses without timestamps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ text: "just text" })));
    await expect(transcribe(Buffer.from("x"), 0, 300, undefined, config)).rejects.toThrow(/timestamps/);
  });

  it("marks its failures as transcription errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "down" }, { status: 503 })));
    const err = await transcribe(Buffer.from("x"), 0, 300, undefined, config).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.kind).toBe("transcription");
  });

  it("retries once when the provider is rate-limiting or briefly down, but not on auth errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(Response.json({ duration: 300, segments: [{ start: 1, end: 2, text: "Hi" }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await transcribe(Buffer.from("x"), 0, 300, undefined, config)).segments).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const unauthorized = vi.fn(async () => Response.json({ error: { message: "Invalid API Key" } }, { status: 401 }));
    vi.stubGlobal("fetch", unauthorized);
    await expect(transcribe(Buffer.from("x"), 0, 300, undefined, config)).rejects.toThrow(/401/);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it("reports a rate limit it can't wait out, with how long until it resets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "Rate limit reached for model `whisper-large-v3-turbo`" } },
          { status: 429, headers: { "retry-after": "102" } },
        ),
      ),
    );
    const err = await transcribe(Buffer.from("x"), 0, 300, undefined, config).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.kind).toBe("rate_limit");
    expect(err.retryAfterMs).toBe(102_000);
  });
});
