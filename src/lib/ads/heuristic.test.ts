import { describe, expect, it } from "vitest";
import { detectAds } from "@/lib/ads/heuristic";
import type { TranscriptSegment } from "@/lib/types";

/**
 * Builds a transcript from lines, each `seconds` long, starting at `start`.
 * The scripts below are synthetic but follow the shapes seen in real
 * Whisper output of popular shows.
 */
function transcript(lines: string[], start = 0, seconds = 4): TranscriptSegment[] {
  return lines.map((text, i) => ({ start: start + i * seconds, end: start + (i + 1) * seconds, text }));
}

function chatter(count: number, start: number, seconds = 4) {
  const topics = [
    "So I think the bigger question is what the coaching staff does next.",
    "Right, and that's been the story all season long.",
    "I went back and watched the tape from last week.",
    "There's a version of this where everything works out.",
    "Honestly I didn't expect that at all.",
    "We talked about this a little bit last time.",
  ];
  return transcript(
    Array.from({ length: count }, (_, i) => topics[i % topics.length]),
    start,
    seconds,
  );
}

describe("detectAds", () => {
  it("finds nothing in ordinary conversation", () => {
    expect(detectAds(chatter(150, 0))).toEqual([]);
  });

  it("returns nothing for an empty transcript", () => {
    expect(detectAds([])).toEqual([]);
  });

  it("detects a host-read sponsor spot from its intro to its call to action", () => {
    const segments = [
      ...chatter(10, 0),
      ...transcript(
        [
          "Today's episode is brought to you by Acme Mattress.",
          "I've been sleeping on one for a year and I love how cool it stays.",
          "It adjusts to your body through the night.",
          "Most people don't realize how much temperature matters for sleep.",
          "Head to acmemattress.com slash show and use code SHOW for 20% off.",
        ],
        40,
      ),
      ...chatter(10, 60),
    ];
    const [ad, ...rest] = detectAds(segments);
    expect(rest).toEqual([]);
    expect(ad.start).toBeGreaterThanOrEqual(40);
    expect(ad.start).toBeLessThan(41);
    expect(ad.end).toBe(60);
  });

  it("keeps a long sponsor read together even when the pitch comes late", () => {
    const body = Array.from({ length: 18 }, () => "It covers all of my foundational health needs every single day.");
    const segments = [
      ...chatter(5, 0),
      ...transcript(["Our first sponsor is Greens Co.", ...body, "Go to greensco.com slash show to claim a special offer."], 20),
      ...chatter(10, 100),
    ];
    const [ad] = detectAds(segments);
    expect(ad.start).toBeLessThanOrEqual(20.5);
    expect(ad.end).toBe(100);
  });

  it("merges back-to-back sponsor reads into one break", () => {
    const segments = [
      ...chatter(5, 0),
      ...transcript(
        [
          "This episode is brought to you by Alpha Glasses.",
          "Go to alphaglasses.com and enter the code SHOW to save 20% off.",
          "Today's episode is also brought to us by Beta Bank.",
          "Visit betabank.com slash show today. Member FDIC.",
        ],
        20,
      ),
      ...chatter(10, 36),
    ];
    const ads = detectAds(segments);
    expect(ads).toHaveLength(1);
    expect(ads[0].start).toBeLessThanOrEqual(20.5);
    expect(ads[0].end).toBe(36);
  });

  it("starts a mid-roll after the host announces the break", () => {
    const segments = [
      ...chatter(10, 0),
      ...transcript(
        [
          "Let's get into the rankings when we come back from the break.",
          "Welcome to the most rewarding season ever, only on BetCo.",
          "Check the BetCo app every week to see exclusive offers.",
          "Visit betco.com to get started. Must be 21 or older. Gambling problem? Call for help.",
        ],
        40,
      ),
      ...chatter(10, 56),
    ];
    const [ad] = detectAds(segments);
    expect(ad.start).toBe(44); // after the "come back" line, not during it
    expect(ad.end).toBe(56);
  });

  it("catches an inserted ad from its offer and legal copy", () => {
    const segments = [
      ...chatter(5, 0),
      ...transcript(
        [
          "Earn 5% cash back in rotating categories every quarter.",
          "Grocery stores, gas stations and restaurants.",
          "It pays to switch. Terms apply.",
          "See cardco.com slash five for details.",
        ],
        20,
      ),
      ...chatter(10, 36),
    ];
    const [ad] = detectAds(segments);
    expect(ad).toBeDefined();
    expect(ad.start).toBe(20);
    expect(ad.end).toBe(36);
  });

  it("does not treat a host plugging a guest's website as an ad", () => {
    const segments = [
      ...chatter(5, 0),
      ...transcript(
        [
          "If you want to go deeper you can go to guestname.com where you'll find his programs.",
          "His videos on lower back pain have millions of views.",
          "Again, it's guestname.com, and he's on YouTube and Instagram.",
        ],
        20,
      ),
      ...chatter(20, 32),
    ];
    expect(detectAds(segments)).toEqual([]);
  });

  it("ignores a passing mention of a sponsor or a break", () => {
    const segments = [
      ...chatter(5, 0),
      ...transcript(["We'll get into the trade rumors after the break, I promise."], 20),
      ...chatter(30, 24),
      ...transcript(["The stadium is sponsored by a bank now, which is wild."], 144),
      ...chatter(10, 148),
    ];
    expect(detectAds(segments)).toEqual([]);
  });

  it("matches phrases Whisper split across segments", () => {
    const segments = [
      ...chatter(5, 0),
      ...transcript(["and that's the show intro. And today's episode", "is brought to you by Squareish.", "Get started at squareish.com slash go slash show."], 20),
      ...chatter(10, 32),
    ];
    const [ad] = detectAds(segments);
    expect(ad).toBeDefined();
    // Starts partway into the first line, where "is brought to you by" begins.
    expect(ad.start).toBeGreaterThan(20);
    expect(ad.start).toBeLessThan(24);
  });

  it("doesn't match a phrase across a gap in the transcript", () => {
    const segments = [
      ...transcript(["and that's why this episode"], 0),
      // A seek skipped this stretch; the next window starts much later.
      ...transcript(["is brought to you by nothing in particular.", ...chatter(5, 0).map((s) => s.text)], 300),
    ];
    expect(detectAds(segments)).toEqual([]);
  });

  it("extends the end over the pause before speech resumes", () => {
    const segments = [
      ...transcript(
        ["This episode is brought to you by Acme.", "Use promo code SHOW at acme.com slash show."],
        0,
      ),
      // 2.5s of silence, then the show.
      { start: 10.5, end: 14, text: "Okay, we're back." },
    ];
    const [ad] = detectAds(segments);
    expect(ad.end).toBe(10.5);
  });
});
