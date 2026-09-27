import { forwardRef } from "react";
import { cx } from "@/components/ui/cx";

export const inputStyles =
  "h-11 w-full border border-text/20 bg-bg px-3 text-sm text-text placeholder:text-faint transition-colors hover:border-text/50 focus:border-text focus:outline-none";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx(inputStyles, className)} {...props} />;
});

/** A labelled form control, with an optional hint on the right of the label. */
export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
        {label}
        {hint && <span className="text-xs font-normal text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
