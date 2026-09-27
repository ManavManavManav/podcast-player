// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Waveform } from "@/components/player/Waveform";

afterEach(cleanup);

const flat = (level: number) => new Uint8Array(6000 * 3).fill(level);

function renderAt(currentTime: number, props: Partial<React.ComponentProps<typeof Waveform>> = {}) {
  const onSeek = vi.fn();
  const view = render(<Waveform currentTime={currentTime} duration={1800} ads={[]} windows={{}} envelopes={{}} onSeek={onSeek} {...props} />);
  return { ...view, onSeek, slider: screen.getByRole("slider", { name: "Seek" }) };
}

describe("Waveform keyboard", () => {
  it("jumps like the player's buttons: 15 s back, 30 s forward", () => {
    const { onSeek, slider } = renderAt(600);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onSeek.mock.calls).toEqual([[585], [630]]);
  });

  it("takes a fine 5 s step with Shift", () => {
    const { onSeek, slider } = renderAt(600);
    fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(onSeek.mock.calls).toEqual([[595], [605]]);
  });

  it("goes to the start and end with Home and End", () => {
    const { onSeek, slider } = renderAt(600);
    fireEvent.keyDown(slider, { key: "Home" });
    fireEvent.keyDown(slider, { key: "End" });
    expect(onSeek.mock.calls).toEqual([[0], [1799]]);
  });

  it("leaves other keys alone", () => {
    const { onSeek, slider } = renderAt(600);
    fireEvent.keyDown(slider, { key: "k" });
    expect(onSeek).not.toHaveBeenCalled();
  });
});

describe("Waveform bars", () => {
  it("draws measured parts as bars and the rest as a baseline", () => {
    // 24 bars over 30 minutes: the first window (5 min) covers the first 4.
    const { container } = renderAt(0, { envelopes: { 0: flat(220) } });
    const bars = [...container.querySelectorAll<HTMLElement>("[data-bar]")];
    expect(bars).toHaveLength(24);
    expect(bars[0].style.height).toBe("100%");
    expect(bars[0].style.minHeight).toBe("3px");
    expect(bars[10].style.height).toBe("2px");
  });

  it("marks ads in orange, and what's been played in ink", () => {
    const ads = [{ start: 150, end: 225, confidence: 1, reason: "Ad: Acme" }]; // bar 2 (150–225 s)
    const { container } = renderAt(160, { envelopes: { 0: flat(220) }, ads });
    const bars = [...container.querySelectorAll<HTMLElement>("[data-bar]")];
    expect(bars[0].className).toMatch(/\bbg-text\b/);
    expect(bars[2].className).toMatch(/\bbg-ad\b/);
    expect(bars[3].className).toMatch(/bg-text\/25/);
  });
});

describe("Waveform preview", () => {
  const ads = [{ start: 20, end: 50, confidence: 1, reason: "Ad: Acme" }];
  const segments = [
    { start: 0, end: 20, text: "Welcome back to the show." },
    { start: 20, end: 50, text: "This episode is brought to you by Acme." },
  ];

  function hoverAt(clientX: number) {
    const { slider } = renderAt(0, { duration: 100, ads, segments });
    slider.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 36, right: 100, bottom: 36, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerMove(slider, { clientX, pointerType: "mouse" });
  }

  it("shows the time and what's said there", () => {
    hoverAt(10);
    expect(screen.getByText("0:10")).toBeTruthy();
    expect(screen.getByText("Welcome back to the show.")).toBeTruthy();
  });

  it("names the ad under the pointer", () => {
    hoverAt(30);
    expect(screen.getByText(/Ad ·/).textContent).toMatch(/Ad · Acme/);
  });
});
