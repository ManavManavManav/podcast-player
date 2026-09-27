// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NowPlayingPanel } from "@/components/player/NowPlayingPanel";
import { useAnalysis } from "@/store/analysis";
import { usePlayback } from "@/store/player";

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

  it("re-renders the transcript when the current line changes, not on every playback tick", () => {
    // A three-hour episode: 3,000 lines of 3.6 s.
    const segments = Array.from({ length: 3000 }, (_, i) => ({ start: i * 3.6, end: i * 3.6 + 3.6, text: `line ${i}` }));
    act(() => {
      useAnalysis.setState({ segments, ads: [] });
      usePlayback.setState({ currentTime: 99 });
    });
    let commits = 0;
    let renderMs = 0;
    render(
      <Profiler id="panel" onRender={(_id, _phase, actualDuration) => ((commits += 1), (renderMs += actualDuration))}>
        <NowPlayingPanel />
      </Profiler>,
    );
    commits = 0;
    renderMs = 0;
    // 5 s of playback at timeupdate's ~4 Hz; the current line changes twice (100.8 s, 104.4 s).
    for (let t = 100; t < 105; t += 0.25) act(() => usePlayback.setState({ currentTime: t }));
    expect(commits).toBeLessThanOrEqual(3);
    console.log(`transcript panel: ${commits} commits, ${renderMs.toFixed(0)} ms rendering over 20 ticks`);
  });

  it("switches tabs with the arrow keys and links each tab to its panel", () => {
    act(() => useAnalysis.setState({ segments: [{ start: 0, end: 5, text: "hello" }], ads: [] }));
    render(<NowPlayingPanel />);
    const transcript = screen.getByRole("tab", { name: "Transcript" });
    const ads = screen.getByRole("tab", { name: /Ad breaks/ });
    expect(transcript.getAttribute("aria-selected")).toBe("true");
    expect(transcript.tabIndex).toBe(0);
    expect(ads.tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(transcript.id);

    fireEvent.keyDown(transcript, { key: "ArrowRight" });
    expect(ads.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(ads);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(ads.id);
    fireEvent.keyDown(ads, { key: "ArrowRight" });
    expect(transcript.getAttribute("aria-selected")).toBe("true");
  });

  it("marks the current line, even inside an ad", () => {
    act(() => {
      useAnalysis.setState({
        segments: [
          { start: 0, end: 10, text: "before" },
          { start: 10, end: 20, text: "sponsor read" },
        ],
        ads: [{ start: 10, end: 20, confidence: 1, reason: "Ad: Acme" }],
      });
      usePlayback.setState({ currentTime: 12 });
    });
    render(<NowPlayingPanel />);
    const line = screen.getByText("sponsor read").closest("button")!;
    expect(line.getAttribute("aria-current")).toBe("true");
    expect(line.className).toMatch(/bg-ad-soft/);
    expect(line.className).toMatch(/before:bg-text/);
    expect(screen.getByText("before").closest("button")!.hasAttribute("aria-current")).toBe(false);
  });
});
