import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { create } };
  },
}));

const { classifyWindow, claudeEnabled } = await import("@/lib/server/claudeDetector");

const window = [
  { start: 60, end: 64, text: "This episode is brought to you by Acme." },
  { start: 64, end: 70, text: "Go to acme.com slash show." },
  { start: 70, end: 80, text: "Anyway, back to the draft." },
];

function reply(json: unknown, stop_reason = "end_turn") {
  create.mockResolvedValueOnce({ stop_reason, content: [{ type: "text", text: JSON.stringify(json) }] });
}

describe("classifyWindow", () => {
  beforeEach(() => create.mockReset());

  it("sends context and window lines, and asks for structured output", async () => {
    reply({ ads: [] });
    await classifyWindow(window, [{ start: 58, end: 60, text: "Before the window." }]);

    const [params] = create.mock.calls[0];
    expect(params.model).toBe("claude-opus-5");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.fallbacks).toBe("default");
    const prompt = params.messages[0].content as string;
    expect(prompt).toContain("CONTEXT [58.0-60.0] Before the window.");
    expect(prompt).toContain("WINDOW [60.0-64.0] This episode is brought to you by Acme.");
  });

  it("returns ads clamped to the window", async () => {
    reply({ ads: [{ start: 50, end: 70.2, advertiser: "Acme" }] });
    expect(await classifyWindow(window, [])).toEqual([
      { start: 60, end: 70.2, confidence: 0.9, reason: "Ad: Acme" },
    ]);
  });

  it("drops slivers and nonsense ranges", async () => {
    reply({ ads: [{ start: 61, end: 62, advertiser: "x" }, { start: "a", end: 70, advertiser: "y" }] });
    expect(await classifyWindow(window, [])).toEqual([]);
  });

  it("treats a refusal as no ads", async () => {
    create.mockResolvedValueOnce({ stop_reason: "refusal", content: [] });
    expect(await classifyWindow(window, [])).toEqual([]);
  });

  it("throws on malformed output so the heuristic takes over", async () => {
    create.mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "{nope" }] });
    await expect(classifyWindow(window, [])).rejects.toThrow("malformed");
  });

  it("skips the API call for an empty window", async () => {
    expect(await classifyWindow([], [])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("claudeEnabled", () => {
  it("follows AD_DETECTOR and the API key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    vi.stubEnv("AD_DETECTOR", "");
    expect(claudeEnabled()).toBe(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    expect(claudeEnabled()).toBe(true);
    vi.stubEnv("AD_DETECTOR", "heuristic");
    expect(claudeEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});
