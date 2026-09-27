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
