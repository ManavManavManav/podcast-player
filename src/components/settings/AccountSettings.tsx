"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/authClient";

export function AccountSettings({ name, email }: { name: string; email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (error) {
      setStatus({
        kind: "error",
        text: error.code === "INVALID_PASSWORD" ? "Your current password is incorrect." : (error.message ?? "Couldn't change password."),
      });
      return;
    }
    setCurrent("");
    setNext("");
    setStatus({ kind: "ok", text: "Password changed. Other devices were signed out." });
  };

  return (
    <section>
      <h2 className="text-lg font-semibold">Account</h2>
      <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted">Name</dt>
        <dd>{name}</dd>
        <dt className="text-muted">Email</dt>
        <dd>{email}</dd>
      </dl>

      <form onSubmit={changePassword} className="mt-6 grid max-w-sm gap-3">
        <h3 className="text-sm font-medium">Change password</h3>
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="h-10 rounded-lg border border-border bg-bg px-3 text-sm focus:border-accent focus:outline-none"
        />
        <input
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          placeholder="New password (10+ characters)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="h-10 rounded-lg border border-border bg-bg px-3 text-sm focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="hover-breathe flex h-10 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50 [--hover-scale:1.04]"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            Change password
          </button>
          {status && (
            <p className={`flex items-center gap-1.5 text-sm ${status.kind === "ok" ? "text-accent" : "text-danger"}`}>
              {status.kind === "ok" ? <Check className="size-4" /> : <CircleAlert className="size-4" />}
              {status.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
