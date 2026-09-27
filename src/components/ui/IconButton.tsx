import { forwardRef } from "react";
import { cx } from "@/components/ui/cx";

/**
 * A round icon-only button. `label` is its accessible name and tooltip.
 * `className` adds to the defaults; to hide it at some sizes use variants
 * (`max-sm:hidden`, `sm:hidden`), which override its `grid` display.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string; size?: "sm" | "md" }
>(function IconButton({ label, size = "md", className, children, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "hover-breathe touch-target relative grid shrink-0 place-items-center rounded-full text-text hover:bg-surface-2",
        size === "md" ? "size-9" : "size-8",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
