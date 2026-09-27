import { beforeEach, describe, expect, it } from "vitest";
import { adAt, useAnalysis } from "@/store/analysis";

const seg = (start: number, text = `line ${start}`) => ({ start, end: start + 5, text });
const ad = (start: number, end: number) => ({ start, end, confidence: 0.9, reason: "Ad" });

beforeEach(() => useAnalysis.getState().reset("https://a/ep.mp3"));

describe("analysis store", () => {
  it("adds windows, replacing that window's transcript and taking the latest ads", () => {
    const s = useAnalysis.getState();
    s.addWindow(300, [seg(310), seg(305)], [ad(305, 320)]);
    s.addWindow(0, [seg(10)], [ad(10, 20), ad(305, 320)]);
    s.addWindow(300, [seg(301, "redone")], [ad(10, 20)]);
    const state = useAnalysis.getState();
    expect(state.windows).toEqual({ 0: "done", 300: "done" });
    expect(state.segments.map((x) => [x.start, x.text])).toEqual([[10, "line 10"], [301, "redone"]]);
    expect(state.ads).toEqual([ad(10, 20)]);
  });

  it("restores a cached snapshot without overwriting newer results", () => {
    const s = useAnalysis.getState();
    s.addWindow(300, [seg(310)], [ad(305, 320)]);
    s.restore({ windows: [0, 300], segments: [seg(10), seg(310, "old")], ads: [ad(1, 2)] });
    const state = useAnalysis.getState();
    expect(state.windows).toEqual({ 0: "done", 300: "done" });
    expect(state.segments.map((x) => x.text)).toEqual(["line 10", "line 310"]);
    expect(state.ads).toEqual([ad(305, 320)]);
  });

  it("tracks and clears window status, and resets per episode", () => {
    const s = useAnalysis.getState();
    s.setStatus(0, "pending");
    s.setStatus(300, "error");
    s.clearStatus(300);
    s.setError("boom");
    expect(useAnalysis.getState().windows).toEqual({ 0: "pending" });
    s.reset("https://a/other.mp3");
    expect(useAnalysis.getState()).toMatchObject({ url: "https://a/other.mp3", windows: {}, segments: [], ads: [], error: null });
  });

  it("finds the ad at a time (start inclusive, end exclusive)", () => {
    const ads = [ad(10, 20), ad(30, 40)];
    expect(adAt(ads, 10)).toEqual(ads[0]);
    expect(adAt(ads, 19.9)).toEqual(ads[0]);
    expect(adAt(ads, 20)).toBeUndefined();
    expect(adAt(ads, 35)).toEqual(ads[1]);
  });

  it("keeps each window's loudness envelope, decoded, from fresh and cached results", () => {
    const s = useAnalysis.getState();
    s.reset("https://a/ep.mp3");
    s.addWindow(0, [], [], "AQID"); // bytes 1, 2, 3
    expect([...useAnalysis.getState().envelopes[0]]).toEqual([1, 2, 3]);
    s.restore({ windows: [0, 300], segments: [], ads: [], envelopes: { 0: "BAUG", 300: "BwgJ" } });
    // A window already in memory keeps its envelope; new ones are added.
    expect([...useAnalysis.getState().envelopes[0]]).toEqual([1, 2, 3]);
    expect([...useAnalysis.getState().envelopes[300]]).toEqual([7, 8, 9]);
    s.reset("https://a/other.mp3");
    expect(useAnalysis.getState().envelopes).toEqual({});
  });
});
