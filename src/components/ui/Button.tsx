import { LoaderCircle } from "lucide-react";
import { cx } from "@/components/ui/cx";

export type ButtonVariant = "primary" | "outline" | "subtle" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-text",
  outline: "border border-accent text-text",
  subtle: "border border-border text-text hover:bg-surface-2",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "hover-breathe h-11 gap-2 px-6 text-sm [--hover-scale:1.04]",
  lg: "hover-breathe h-12 gap-2.5 px-6 text-body [--hover-scale:1.03]",
};

/** The pill button's classes, for links and other elements that should look like one. */
export function buttonStyles({ variant = "primary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}) {
  return cx(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-medium disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
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
