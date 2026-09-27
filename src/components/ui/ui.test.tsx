// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";

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
