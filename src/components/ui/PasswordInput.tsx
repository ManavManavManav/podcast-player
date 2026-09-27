"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";
import { Input } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";

/** A password field with a show/hide toggle and a Caps Lock warning. */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { containerClassName?: string }
>(function PasswordInput({ className, containerClassName, onKeyDown, onKeyUp, onBlur, ...props }, ref) {
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const checkCaps = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  return (
    <span className={cx("grid gap-1", containerClassName)}>
      <span className="relative block">
        <Input
          ref={ref}
          type={shown ? "text" : "password"}
          className={cx("pr-12", className)}
          onKeyDown={(e) => {
            checkCaps(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            checkCaps(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCapsLock(false);
            onBlur?.(e);
          }}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="touch-target absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-faint hover:bg-text hover:text-bg"
        >
          {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </span>
      {capsLock && (
        <span role="status" className="px-4 text-xs text-ad-text">
          Caps Lock is on
        </span>
      )}
    </span>
  );
});
