import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const constructed: Array<{ apiKey: string }> = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { create } };
    constructor(options: { apiKey: string }) {
      constructed.push(options);
    }
  },
}));

const { classifyWithClaude } = await import("@/lib/server/llm/claude");

const window = [
  { start: 60, end: 64, text: "This episode is brought to you by Acme." },
  { start: 64, end: 70, text: "Go to acme.com slash show." },
  { start: 70, end: 80, text: "Anyway, back to the draft." },
];
const config = { apiKey: "sk-ant-user-one", model: "claude-opus-5" };

function reply(json: unknown, stop_reason = "end_turn") {
  create.mockResolvedValueOnce({ stop_reason, content: [{ type: "text", text: JSON.stringify(json) }] });
}

describe("classifyWithClaude", () => {
  beforeEach(() => create.mockReset());

  it("sends context and window lines with the user's model and structured output", async () => {
    reply({ ads: [] });
    await classifyWithClaude(window, [{ start: 58, end: 60, text: "Before the window." }], config);

    const [params] = create.mock.calls[0];
    expect(params.model).toBe("claude-opus-5");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.fallbacks).toBe("default");
    const prompt = params.messages[0].content as string;
    expect(prompt).toContain("CONTEXT [58.0-60.0] Before the window.");
    expect(prompt).toContain("WINDOW [60.0-64.0] This episode is brought to you by Acme.");
  });

  it("uses a separate client per API key", async () => {
    reply({ ads: [] });
    reply({ ads: [] });
    await classifyWithClaude(window, [], config);
    await classifyWithClaude(window, [], { ...config, apiKey: "sk-ant-user-two" });
    expect(constructed.map((c) => c.apiKey)).toEqual(["sk-ant-user-one", "sk-ant-user-two"]);
  });

  it("returns ads clamped to the window", async () => {
    reply({ ads: [{ start: 50, end: 70.2, advertiser: "Acme" }] });
    expect(await classifyWithClaude(window, [], config)).toEqual([
      { start: 60, end: 70.2, confidence: 0.9, reason: "Ad: Acme" },
    ]);
  });

  it("treats a refusal as no ads", async () => {
    create.mockResolvedValueOnce({ stop_reason: "refusal", content: [] });
    expect(await classifyWithClaude(window, [], config)).toEqual([]);
  });

  it("skips the API call for an empty window", async () => {
    expect(await classifyWithClaude([], [], config)).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});
