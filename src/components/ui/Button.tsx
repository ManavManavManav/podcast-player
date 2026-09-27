import { LoaderCircle } from "lucide-react";
import { cx } from "@/components/ui/cx";

/**
 * Buttons are words: uppercase, square, struck through on hover. Primary is
 * an ink block; outline an ink rule; word is bare text that becomes an ink
 * block when pressed (aria-pressed / aria-current / aria-selected).
 */
export type ButtonVariant = "primary" | "outline" | "subtle" | "danger" | "word";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-text text-bg",
  outline: "border border-text text-text",
  subtle: "border border-text/20 text-text hover:border-text",
  danger: "border border-danger/50 text-danger hover:border-danger",
  word: "text-text aria-pressed:bg-text aria-pressed:text-bg aria-[current=page]:bg-text aria-[current=page]:text-bg aria-selected:bg-text aria-selected:text-bg",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2.5 px-5 text-sm",
};

/** A button's classes, for links and other elements that should look like one. */
export function buttonStyles({ variant = "primary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}) {
  return cx(
    "press inline-flex shrink-0 items-center justify-center whitespace-nowrap uppercase leading-none tracking-[0.02em] hover:line-through focus-visible:line-through disabled:pointer-events-none disabled:opacity-50 aria-pressed:no-underline",
    VARIANTS[variant],
    variant === "word" && size !== "sm" ? "h-8 px-2 text-sm" : SIZES[size],
  );
}

export function Button({
  variant,
  size,
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonStyles({ variant, size }), className)}
      {...props}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
