// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
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
});
