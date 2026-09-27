"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { AdminUser } from "@/lib/types";

type Action = "approve" | "disable" | "enable" | "delete" | "set-password";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function AdminPanel({ initial, selfId }: { initial: AdminUser[]; selfId: string }) {
  const [users, setUsers] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (user: AdminUser, action: Action, extra: Record<string, string> = {}) => {
    if (action === "delete" && !window.confirm(`Delete ${user.email}? Their account and history are removed.`)) return;
    setBusy(`${user.id}:${action}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
      setUsers(body as AdminUser[]);
      if (action === "set-password") {
        setPasswordFor(null);
        setPassword("");
        setNotice(`Password set for ${user.email}. Share it with them privately.`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pending = users.filter((u) => !u.approved).length;

  return (
    <section className="space-y-4">
      <p className="font-mono text-meta text-faint">
        {users.length} {users.length === 1 ? "account" : "accounts"}
        {pending > 0 && <span className="font-medium text-ad-text"> · {pending} waiting for approval</span>}
      </p>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </p>
      )}
      {notice && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{notice}</p>}

      <ul className="divide-y divide-border overflow-hidden rounded-3xl bg-surface px-2">
        {users.map((user) => {
          const self = user.id === selfId;
          const button = (action: Action, label: string, danger = false) => (
            <button
              key={action}
              onClick={() => act(user, action)}
              disabled={busy !== null}
              className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium disabled:opacity-50 ${
                danger ? "border-danger/40 text-danger hover:bg-danger/10" : "border-border hover:bg-surface-2"
              }`}
            >
              {busy === `${user.id}:${action}` && <LoaderCircle className="size-3 animate-spin" />}
              {label}
            </button>
          );

          return (
            <li key={user.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
              <div className="min-w-0 flex-1 basis-60">
                <p className="flex items-center gap-2 truncate">
                  <span className="truncate font-serif text-xl">{user.name || user.email}</span>
                  <Status user={user} />
                </p>
                <p className="truncate text-xs text-muted">
                  {user.email} · joined {dateFormat.format(new Date(user.createdAt))}
                </p>
              </div>

              <p className="font-mono text-xs text-faint" title="This month: minutes transcribed, detector calls, tokens in/out">
                {user.usage.audioMinutes} min · {user.usage.detectCalls} calls ·{" "}
                {Math.round((user.usage.inputTokens + user.usage.outputTokens) / 1000)}k tokens
              </p>

              {!self && (
                <div className="flex flex-wrap gap-2">
                  {!user.approved && [button("approve", "Approve"), button("delete", "Reject", true)]}
                  {user.approved && !user.banned && user.role !== "admin" && [
                    <button
                      key="password"
                      onClick={() => setPasswordFor(passwordFor === user.id ? null : user.id)}
                      disabled={busy !== null}
                      className="h-8 rounded-full border border-border px-3 text-xs font-medium hover:bg-surface-2 disabled:opacity-50"
                    >
                      Set password
                    </button>,
                    button("disable", "Disable"),
                    button("delete", "Delete", true),
                  ]}
                  {user.approved && user.banned && [button("enable", "Enable"), button("delete", "Delete", true)]}
                </div>
              )}

              {passwordFor === user.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(user, "set-password", { password });
                  }}
                  className="flex w-full flex-wrap items-center gap-2"
                >
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={10}
                    autoComplete="new-password"
                    placeholder="New password (10+ characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-full bg-bg px-4 text-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-pressed={showPassword}
                    className="h-10 rounded-full border border-border px-4 text-xs font-medium hover:bg-surface-2"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className="h-10 rounded-full bg-accent px-5 text-xs font-medium text-accent-text disabled:opacity-50"
                  >
                    Save
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Status({ user }: { user: AdminUser }) {
  const [label, className] = user.role === "admin"
    ? ["Admin", "bg-accent-soft text-accent"]
    : !user.approved
      ? ["Waiting", "bg-ad-soft text-ad-text"]
      : user.banned
        ? ["Disabled", "bg-danger/10 text-danger"]
        : ["Active", "bg-surface-2 text-muted"];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-micro font-medium ${className}`}>{label}</span>;
}
