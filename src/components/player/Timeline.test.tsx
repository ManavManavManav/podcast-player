// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/player/Timeline";

afterEach(cleanup);

function renderAt(currentTime: number) {
  const onSeek = vi.fn();
  render(<Timeline currentTime={currentTime} duration={1800} ads={[]} windows={{}} onSeek={onSeek} />);
  return { onSeek, slider: screen.getByRole("slider", { name: "Seek" }) };
}

describe("Timeline keyboard", () => {
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

describe("Timeline preview", () => {
  const ads = [{ start: 20, end: 50, confidence: 1, reason: "Ad: Acme" }];
  const segments = [
    { start: 0, end: 20, text: "Welcome back to the show." },
    { start: 20, end: 50, text: "This episode is brought to you by Acme." },
  ];

  function hoverAt(clientX: number) {
    render(<Timeline currentTime={0} duration={100} ads={ads} windows={{}} segments={segments} onSeek={() => {}} />);
    const slider = screen.getByRole("slider", { name: "Seek" });
    slider.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 32, right: 100, bottom: 32, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerMove(slider, { clientX, pointerType: "mouse" });
  }

  it("shows the time and what's said there", () => {
    hoverAt(10);
    expect(screen.getByText("0:10")).toBeTruthy();
    expect(screen.getByText("Welcome back to the show.")).toBeTruthy();
    expect(screen.queryByText(/Acme$/)).toBeNull();
  });

  it("names the ad under the pointer", () => {
    hoverAt(30);
    expect(screen.getByText(/Ad ·/).textContent).toMatch(/Ad · Acme/);
    expect(screen.getByText("This episode is brought to you by Acme.")).toBeTruthy();
  });

  it("draws short ads at least 3 px wide", () => {
    const { container } = render(
      <Timeline currentTime={0} duration={3600} ads={[{ start: 60, end: 90, confidence: 1, reason: "Ad" }]} windows={{}} onSeek={() => {}} />,
    );
    const marker = container.querySelector<HTMLElement>(".bg-ad")!;
    expect(marker.style.minWidth).toBe("3px");
  });
});
