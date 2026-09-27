import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors";
import { detectAds } from "@/lib/server/llm/detect";

const window = [
  { start: 300, end: 310, text: "This episode is brought to you by Acme." },
  { start: 310, end: 340, text: "Acme makes great widgets. Use code POD." },
  { start: 340, end: 360, text: "Anyway, back to the story." },
];

const answer = (content: string | null, extra: object = {}) =>
  Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 40 }, ...extra });

afterEach(() => vi.unstubAllGlobals());

describe("detectAds", () => {
  it("asks for JSON without reasoning and parses the ads", async () => {
    const fetchMock = vi.fn(async () => answer('{"ads":[{"start":300,"end":340,"advertiser":"Acme"}]}'));
    vi.stubGlobal("fetch", fetchMock);

    const config = { baseUrl: "https://llm.example/v1", apiKey: "sk", model: "model-a" };
    const result = await detectAds(window, [], {}, config);
    expect(result).toEqual({
      ads: [{ start: 300, end: 340, confidence: 0.9, reason: "Ad: Acme" }],
      inputTokens: 900,
      outputTokens: 40,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("retries without the extras when an API rejects them, and remembers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "Unrecognized request argument: thinking" } }, { status: 400 }))
      .mockImplementation(async () => answer('{"ads":[]}'));
    vi.stubGlobal("fetch", fetchMock);

    const config = { baseUrl: "https://llm.example/v1", apiKey: "sk", model: "model-b" };
    expect((await detectAds(window, [], {}, config)).ads).toEqual([]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).thinking).toBeUndefined();

    await detectAds(window, [], {}, config);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body)).thinking).toBeUndefined();
  });

  it("doesn't call the API for a window with no speech", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const config = { baseUrl: "https://llm.example/v1", apiKey: "sk", model: "model-a" };
    expect(await detectAds([], [], {}, config)).toEqual({ ads: [], inputTokens: 0, outputTokens: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly on auth errors and empty answers", async () => {
    const config = { baseUrl: "https://llm.example/v1", apiKey: "bad", model: "model-a" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Invalid key" } }, { status: 401 })));
    await expect(detectAds(window, [], {}, config)).rejects.toThrow("Ad detection failed (401): Invalid key");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: null }, finish_reason: "length" }] })));
    await expect(detectAds(window, [], {}, config)).rejects.toThrow(/ran out of tokens/);
  });

  it("marks its failures as detection errors", async () => {
    const config = { baseUrl: "https://llm.example/v1", apiKey: "sk", model: "model-a" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "down" }, { status: 503 })));
    const apiError = await detectAds(window, [], {}, config).catch((e) => e);
    expect(apiError).toBeInstanceOf(AppError);
    expect(apiError.kind).toBe("detection");

    vi.stubGlobal("fetch", vi.fn(async () => answer("no json here")));
    const parseError = await detectAds(window, [], {}, config).catch((e) => e);
    expect(parseError).toBeInstanceOf(AppError);
    expect(parseError.kind).toBe("detection");
  });

  it("doesn't give up on the extras for errors that aren't about them (E-3)", async () => {
    const config = { baseUrl: "https://llm.example/v1", apiKey: "sk", model: "model-context" };
    const tooLong = () => Response.json({ error: { message: "This model's maximum context length is 8192 tokens" } }, { status: 400 });
    vi.stubGlobal("fetch", vi.fn(async () => tooLong()));
    await expect(detectAds(window, [], {}, config)).rejects.toThrow(/context length/);

    const fetchMock = vi.fn(async () => answer('{"ads":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    await detectAds(window, [], {}, config);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).thinking).toEqual({ type: "disabled" });
  });

  it("retries once when the provider is rate-limiting or briefly down", async () => {
    const config = { baseUrl: "https://llm.example/v1", apiKey: "sk", model: "model-retry" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "retry-after": "0" } }))
      .mockImplementation(async () => answer('{"ads":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    expect((await detectAds(window, [], {}, config)).ads).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Still asked with the extras: a 503 says nothing about them.
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).thinking).toEqual({ type: "disabled" });
  });
});
