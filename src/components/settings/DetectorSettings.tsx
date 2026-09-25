"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { DetectorKind, KeyStatus, UserSettings } from "@/lib/types";

type Provider = "zai" | "anthropic";

const OPTIONS: Array<{
  kind: DetectorKind;
  title: string;
  blurb: string;
  cost: string;
}> = [
  {
    kind: "heuristic",
    title: "On-device",
    blurb: "Spots sponsor reads, promo codes, links and legal copy. Private, no key needed. Can miss brand spots with no link or code.",
    cost: "Free",
  },
  {
    kind: "glm",
    title: "GLM (Z.ai)",
    blurb: "An AI model reads each minute of transcript, so it also catches brand spots. Uses your Z.ai key.",
    cost: "glm-4.7-flash is free",
  },
  {
    kind: "claude",
    title: "Claude (Anthropic)",
    blurb: "The most accurate option. Uses your Anthropic key.",
    cost: "Roughly $0.10–$1 per hour of audio, depending on model",
  },
];

const MODEL_SUGGESTIONS: Record<"glm" | "claude", string[]> = {
  glm: ["glm-4.7-flash", "glm-4.5-flash", "glm-5.3-flash"],
  claude: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
};

const KEY_LINKS: Record<Provider, { label: string; href: string }> = {
  zai: { label: "Get a Z.ai key", href: "https://z.ai/manage-apikey/apikey-list" },
  anthropic: { label: "Get an Anthropic key", href: "https://console.anthropic.com/settings/keys" },
};

export function DetectorSettings({ initial }: { initial: UserSettings }) {
  const [saved, setSaved] = useState(initial);
  const [detector, setDetector] = useState(initial.detector);
  const [glmModel, setGlmModel] = useState(initial.glmModel);
  const [claudeModel, setClaudeModel] = useState(initial.claudeModel);
  /** A newly typed key (undefined = unchanged, null = remove). */
  const [keys, setKeys] = useState<Record<Provider, string | null | undefined>>({ zai: undefined, anthropic: undefined });
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const dirty =
    detector !== saved.detector ||
    glmModel !== saved.glmModel ||
    claudeModel !== saved.claudeModel ||
    keys.zai !== undefined ||
    keys.anthropic !== undefined;

  const payload = () => ({
    detector,
    glmModel: glmModel.trim(),
    claudeModel: claudeModel.trim(),
    ...(keys.zai !== undefined ? { zaiKey: keys.zai } : {}),
    ...(keys.anthropic !== undefined ? { anthropicKey: keys.anthropic } : {}),
  });

  const submit = async (test: boolean) => {
    setBusy(test ? "test" : "save");
    setStatus(null);
    try {
      const res = await fetch(test ? "/api/settings/test" : "/api/settings", {
        method: test ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const body = await res.json();
      if (test) {
        // The test endpoint saves first, so refresh what's stored.
        const fresh = (await fetch("/api/settings").then((r) => r.json())) as UserSettings;
        setSaved(fresh);
        setKeys({ zai: undefined, anthropic: undefined });
        setStatus(body.ok ? { kind: "ok", text: body.message } : { kind: "error", text: body.error });
      } else if (!res.ok) {
        setStatus({ kind: "error", text: body.error ?? "Couldn't save settings." });
      } else {
        setSaved(body as UserSettings);
        setKeys({ zai: undefined, anthropic: undefined });
        setStatus({ kind: "ok", text: "Saved. New settings apply to the next minute Podblock analyzes." });
      }
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach the server." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h2 className="text-lg font-semibold">Ad detection</h2>
      <p className="mt-1 text-sm text-muted">
        Choose how Podblock decides what&apos;s an ad. Transcripts are shared across accounts on this server; your API keys
        are encrypted and only used for your listening.
      </p>

      <div role="radiogroup" aria-label="Ad detector" className="mt-5 grid gap-2.5">
        {OPTIONS.map((option) => {
          const selected = detector === option.kind;
          return (
            <div
              key={option.kind}
              className={`rounded-2xl border transition ${selected ? "border-accent bg-accent-soft/40" : "border-border bg-surface"}`}
            >
              <button
                role="radio"
                aria-checked={selected}
                aria-label={`${option.title}: ${option.cost}`}
                onClick={() => setDetector(option.kind)}
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                <span
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 ${
                    selected ? "border-accent bg-accent text-accent-text" : "border-border"
                  }`}
                >
                  {selected && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{option.title}</span>
                    <span className="text-xs text-faint">{option.cost}</span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">{option.blurb}</span>
                </span>
              </button>

              {selected && option.kind !== "heuristic" && (
                <div className="grid gap-4 border-t border-border/70 px-4 pb-4 pt-4 sm:pl-12">
                  <ModelField
                    kind={option.kind}
                    value={option.kind === "glm" ? glmModel : claudeModel}
                    onChange={option.kind === "glm" ? setGlmModel : setClaudeModel}
                  />
                  <KeyField
                    // Remount after a save so the field collapses to the saved key.
                    key={JSON.stringify(saved.keys[option.kind === "glm" ? "zai" : "anthropic"])}
                    provider={option.kind === "glm" ? "zai" : "anthropic"}
                    status={saved.keys[option.kind === "glm" ? "zai" : "anthropic"]}
                    value={keys[option.kind === "glm" ? "zai" : "anthropic"]}
                    onChange={(value) =>
                      setKeys((k) => ({ ...k, [option.kind === "glm" ? "zai" : "anthropic"]: value }))
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => submit(false)}
          disabled={!dirty || busy !== null}
          className="flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-text shadow-card transition hover:brightness-110 disabled:opacity-50"
        >
          {busy === "save" && <LoaderCircle className="size-4 animate-spin" />}
          Save
        </button>
        {detector !== "heuristic" && (
          <button
            onClick={() => submit(true)}
            disabled={busy !== null}
            className="flex h-10 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium transition hover:bg-surface-2 disabled:opacity-50"
          >
            {busy === "test" && <LoaderCircle className="size-4 animate-spin" />}
            {dirty ? "Save & test" : "Test"}
          </button>
        )}
        {status && (
          <p
            role="status"
            className={`flex items-center gap-1.5 text-sm ${status.kind === "ok" ? "text-accent" : "text-danger"}`}
          >
            {status.kind === "ok" ? <Check className="size-4" /> : <CircleAlert className="size-4" />}
            {status.text}
          </p>
        )}
      </div>
    </section>
  );
}

function ModelField({ kind, value, onChange }: { kind: "glm" | "claude"; value: string; onChange: (v: string) => void }) {
  const listId = `models-${kind}`;
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">Model</span>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="h-10 w-full max-w-xs rounded-lg border border-border bg-bg px-3 font-mono text-sm focus:border-accent focus:outline-none"
      />
      <datalist id={listId}>
        {MODEL_SUGGESTIONS[kind].map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </label>
  );
}

function KeyField({
  provider,
  status,
  value,
  onChange,
}: {
  provider: Provider;
  status: KeyStatus;
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
}) {
  const [editing, setEditing] = useState(status.status === "none" || status.status === "unreadable");
  const link = KEY_LINKS[provider];

  let summary: React.ReactNode = null;
  if (value === null) summary = <span className="text-danger">Will be removed when you save.</span>;
  else if (status.status === "own") summary = <>Your key <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{status.masked}</code></>;
  else if (status.status === "shared") summary = "Using this server's shared key (billed to the server's owner).";
  else if (status.status === "unreadable")
    summary = <span className="text-danger">Your saved key can&apos;t be read (the server&apos;s secret changed). Enter it again.</span>;

  return (
    <div className="grid gap-1.5">
      <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
        API key
        <a href={link.href} target="_blank" rel="noreferrer" className="text-xs font-normal underline underline-offset-4 hover:text-muted">
          {link.label}
        </a>
      </span>
      {summary && <p className="text-sm text-muted">{summary}</p>}
      {editing || value !== undefined ? (
        <div className="flex max-w-md gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your API key"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            className="h-10 w-full rounded-lg border border-border bg-bg px-3 font-mono text-sm focus:border-accent focus:outline-none"
          />
          {status.status !== "none" && (
            <button
              onClick={() => {
                onChange(undefined);
                setEditing(false);
              }}
              className="shrink-0 rounded-full px-3 text-sm text-muted hover:bg-surface-2"
            >
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-2">
            {status.status === "own" ? "Replace" : "Add your own key"}
          </button>
          {status.status === "own" && (
            <button onClick={() => onChange(null)} className="rounded-full px-3 py-1 text-sm text-danger hover:bg-danger/10">
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
