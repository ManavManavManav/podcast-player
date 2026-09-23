import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyWithGlm, supportsJsonMode } from "@/lib/server/llm/glm";
import { parseAds } from "@/lib/server/llm/prompt";

const window = [
  { start: 0, end: 4, text: "This episode is brought to you by Acme." },
  { start: 4, end: 12, text: "Use code SHOW at acme.com." },
  { start: 12, end: 20, text: "Back to the show." },
];

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("classifyWithGlm", () => {
  it("calls Z.ai with the user's key, thinking off, and JSON mode on text models", async () => {
    const fetchMock = mockFetch(200, {
      choices: [{ message: { content: '{"ads":[{"start":0,"end":12,"advertiser":"Acme"}]}' } }],
    });
    const ads = await classifyWithGlm(window, [], { apiKey: "zai-key-123456", model: "glm-4.7-flash" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer zai-key-123456");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("glm-4.7-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(ads).toEqual([{ start: 0, end: 12, confidence: 0.9, reason: "Ad: Acme" }]);
  });

  it("skips JSON mode on GLM-5.3 Flash (a vision model) and still parses the answer", async () => {
    const fetchMock = mockFetch(200, {
      choices: [{ message: { content: 'Here you go:\n```json\n{"ads": []}\n```' } }],
    });
    expect(await classifyWithGlm(window, [], { apiKey: "zai-key-123456", model: "glm-5.3-flash" })).toEqual([]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toBeUndefined();
  });

  it("surfaces API errors", async () => {
    mockFetch(401, { error: { message: "Invalid API key" } });
    await expect(classifyWithGlm(window, [], { apiKey: "bad-key-000000", model: "glm-4.7-flash" })).rejects.toThrow(
      "Z.ai 401: Invalid API key",
    );
  });

  it("knows which models support JSON mode", () => {
    expect(supportsJsonMode("glm-4.7-flash")).toBe(true);
    expect(supportsJsonMode("glm-5.3")).toBe(true);
    expect(supportsJsonMode("glm-5.3-flash")).toBe(false);
    expect(supportsJsonMode("glm-4.6v-flash")).toBe(false);
  });
});

describe("parseAds", () => {
  it("drops slivers and nonsense ranges", () => {
    expect(parseAds('{"ads":[{"start":1,"end":2},{"start":"a","end":9}]}', window)).toEqual([]);
  });
  it("throws when there's no JSON", () => {
    expect(() => parseAds("I couldn't find any ads.", window)).toThrow("didn't return JSON");
  });
});
