// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NowPlayingPanel } from "@/components/player/NowPlayingPanel";
import { useAnalysis } from "@/store/analysis";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NowPlayingPanel", () => {
  it("says it's transcribing, without promising how much", () => {
    act(() => useAnalysis.getState().reset("https://a/ep.mp3"));
    render(<NowPlayingPanel />);
    expect(screen.getByText(/Transcribing/).textContent).not.toMatch(/first minute/);
  });

  it("lists lines and ads that share a start time without React key clashes", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() =>
      useAnalysis.setState({
        segments: [
          { start: 10, end: 12, text: "one" },
          { start: 10, end: 15, text: "two" },
        ],
        ads: [],
      }),
    );
    render(<NowPlayingPanel />);
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });
});
