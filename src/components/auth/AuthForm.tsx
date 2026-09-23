"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/authClient";

type Mode = "login" | "signup";

const PROVIDER_LABELS = { github: "GitHub", google: "Google" } as const;

export function AuthForm({
  mode,
  next,
  socialProviders,
  signupsAllowed,
}: {
  mode: Mode;
  next: string;
  socialProviders: Array<keyof typeof PROVIDER_LABELS>;
  signupsAllowed: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signup = mode === "signup";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error } = signup
      ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
      : await authClient.signIn.email({ email: email.trim(), password, rememberMe: true });
    if (error) {
      setError(friendlyError(error.code, error.message));
      setPending(false);
      return;
    }
    // A full navigation, so every server component sees the new session.
    window.location.assign(next);
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-7">
      <h1 className="text-xl font-semibold tracking-tight">{signup ? "Create your account" : "Sign in"}</h1>
      <p className="mt-1 text-sm text-muted">
        {signup ? "Your listening history and API keys stay with your account." : "Welcome back."}
      </p>

      {socialProviders.length > 0 && (
        <>
          <div className="mt-6 grid gap-2">
            {socialProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                disabled={pending}
                onClick={() => authClient.signIn.social({ provider, callbackURL: next })}
                className="h-10 rounded-full border border-border text-sm font-medium transition hover:bg-surface-2 disabled:opacity-60"
              >
                Continue with {PROVIDER_LABELS[provider]}
              </button>
            ))}
          </div>
          <div className="my-5 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form onSubmit={submit} className={`grid gap-3.5 ${socialProviders.length ? "" : "mt-6"}`}>
        {signup && (
          <Field label="Name">
            <input required aria-label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
        )}
        <Field label="Email">
          <input
            required
            aria-label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password" hint={signup ? "At least 10 characters" : undefined}>
          <input
            required
            aria-label="Password"
            type="password"
            minLength={signup ? 10 : undefined}
            autoComplete={signup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>

        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 flex h-11 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-accent-text shadow-card transition hover:brightness-110 disabled:opacity-60"
        >
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {signup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        {signup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-accent hover:underline">
              Sign in
            </Link>
          </>
        ) : signupsAllowed ? (
          <>
            New here?{" "}
            <Link href="/signup" className="font-medium text-accent hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          "Accounts are created by this server's owner."
        )}
      </p>
    </div>
  );
}

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text transition focus:border-accent focus:outline-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-baseline justify-between text-sm font-medium">
        {label}
        {hint && <span className="text-xs font-normal text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function friendlyError(code: string | undefined, message: string | undefined) {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match an account.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "There's already an account with that email. Try signing in.";
    case "PASSWORD_TOO_SHORT":
      return "Use a password of at least 10 characters.";
    case "EMAIL_PASSWORD_SIGN_UP_DISABLED":
      return "Sign-ups are closed on this server.";
    default:
      return message || "Something went wrong. Please try again.";
  }
}
