// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { PasswordInput } from "@/components/ui/PasswordInput";

afterEach(cleanup);

describe("IconButton", () => {
  it("keeps its grid layout when classes are added", () => {
    // Replacing the defaults dropped `grid`, which let the "15"/"30" labels fall below the skip icons on phones.
    render(
      <IconButton label="Back 15 seconds" className="sm:hidden">
        <span>15</span>
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Back 15 seconds" });
    expect(button.className.split(" ")).toEqual(expect.arrayContaining(["grid", "place-items-center", "sm:hidden"]));
    expect(button.getAttribute("title")).toBe("Back 15 seconds");
    expect(button.getAttribute("type")).toBe("button");
  });
});

describe("Button", () => {
  it("is disabled and marked busy while loading", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("doesn't submit forms unless asked to", () => {
    render(<Button>Show</Button>);
    expect(screen.getByRole("button", { name: "Show" }).getAttribute("type")).toBe("button");
  });
});

describe("Field", () => {
  it("labels its control", () => {
    render(
      <Field label="Email" hint="We never share it">
        <Input type="email" />
      </Field>,
    );
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByText("We never share it")).toBeTruthy();
  });
});

describe("PasswordInput", () => {
  it("shows and hides the password", () => {
    render(<PasswordInput aria-label="Password" defaultValue="hunter22" />);
    const input = screen.getByLabelText("Password", { exact: true });
    expect(input.getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.getAttribute("type")).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.getAttribute("type")).toBe("password");
  });

  it("warns while Caps Lock is on", () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password", { exact: true });
    // happy-dom doesn't track modifier state, so the event reports it itself.
    const key = (type: string, capsLock: boolean) => {
      const event = new KeyboardEvent(type, { key: "a", bubbles: true });
      Object.defineProperty(event, "getModifierState", { value: (k: string) => capsLock && k === "CapsLock" });
      return event;
    };
    fireEvent(input, key("keydown", true));
    expect(screen.getByText("Caps Lock is on")).toBeTruthy();
    fireEvent(input, key("keyup", false));
    expect(screen.queryByText("Caps Lock is on")).toBeNull();
  });
});
