import { describe, expect, it } from "vitest";
import { whisperLanguage, windowStartFor } from "@/lib/analysis";
import { mergeRanges } from "@/lib/ads/merge";
import { formatClock, formatDate, formatDuration, stripHtml } from "@/lib/text";

describe("stripHtml", () => {
  it("removes tags and decodes entities", () => {
    expect(stripHtml("<p>Tom &amp; Jerry&#39;s <b>show</b></p><p>Part&nbsp;2</p>")).toBe(
      "Tom & Jerry's show\n\nPart 2",
    );
  });
  it("decodes hex entities", () => {
    expect(stripHtml("caf&#xe9;")).toBe("café");
  });
});

describe("formatting", () => {
  it("formats clock times", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(40)).toBe("40 sec");
    expect(formatDuration(540)).toBe("9 min");
    expect(formatDuration(3600)).toBe("1 hr");
    expect(formatDuration(3725)).toBe("1 hr 2 min");
  });
  it("omits the year for dates in the current year", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    expect(formatDate(Date.parse("2026-03-04T12:00:00Z") / 1000, now)).toBe("Mar 4");
    expect(formatDate(Date.parse("2024-03-04T12:00:00Z") / 1000, now)).toBe("Mar 4, 2024");
  });
});

describe("analysis helpers", () => {
  it("aligns times to windows", () => {
    expect(windowStartFor(0)).toBe(0);
    expect(windowStartFor(59.9)).toBe(0);
    expect(windowStartFor(60)).toBe(60);
    expect(windowStartFor(-3)).toBe(0);
  });
  it("normalizes feed languages for Whisper", () => {
    expect(whisperLanguage("en-US")).toBe("en");
    expect(whisperLanguage("fr")).toBe("fr");
    expect(whisperLanguage("")).toBeUndefined();
    expect(whisperLanguage("english")).toBeUndefined();
  });
  it("merges nearby ad ranges", () => {
    const merged = mergeRanges([
      { start: 50, end: 60, confidence: 0.5, reason: "b" },
      { start: 0, end: 30, confidence: 0.9, reason: "a" },
      { start: 200, end: 230, confidence: 0.7, reason: "c" },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 60, confidence: 0.9, reason: "a; b" },
      { start: 200, end: 230, confidence: 0.7, reason: "c" },
    ]);
  });
});
