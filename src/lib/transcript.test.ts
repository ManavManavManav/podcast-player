import { describe, expect, it } from "vitest";
import { currentLine } from "@/lib/transcript";

const lines = [
  { start: 0, end: 5, text: "one" },
  { start: 6, end: 10, text: "two" },
];
const done = () => true;

describe("currentLine", () => {
  it("finds the line the playhead is in", () => {
    expect(currentLine(lines, 2)).toBe(0);
    expect(currentLine(lines, 7)).toBe(1);
  });

  it("keeps a line through a short pause in transcribed audio", () => {
    expect(currentLine(lines, 12, done)).toBe(1);
  });

  it("shows nothing after a long pause", () => {
    expect(currentLine(lines, 20, done)).toBe(-1);
  });

  it("shows nothing after a jump past what's been transcribed, instead of the last known line", () => {
    expect(currentLine(lines, 12)).toBe(-1);
    expect(currentLine(lines, 1200, done)).toBe(-1);
  });

  it("shows nothing before the first line", () => {
    expect(currentLine([{ start: 3, end: 5, text: "late" }], 1, done)).toBe(-1);
  });
});
