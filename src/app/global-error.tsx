"use client";

/**
 * Replaces the root layout when it fails to render, so it brings its own
 * document and styles (the app's stylesheet and fonts aren't loaded here).
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 16 }}>
        <title>Something went wrong · Podblock</title>
        <main style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ opacity: 0.7 }}>Podblock couldn&apos;t load. Please try again in a moment.</p>
          <button onClick={retry} style={{ marginTop: 16, padding: "8px 20px", borderRadius: 999, border: "1px solid currentColor", background: "none", font: "inherit", cursor: "pointer" }}>
            Try again
          </button>
          {error.digest && <p style={{ marginTop: 24, fontFamily: "monospace", fontSize: 12, opacity: 0.5 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
