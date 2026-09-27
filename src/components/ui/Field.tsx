import { forwardRef } from "react";
import { cx } from "@/components/ui/cx";

export const inputStyles =
  "h-11 w-full rounded-full bg-bg px-4 text-sm text-text placeholder:text-faint transition focus:outline-none focus-visible:outline-2 focus-visible:outline-accent";

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
