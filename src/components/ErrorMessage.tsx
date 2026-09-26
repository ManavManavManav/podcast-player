"use client";

/**
 * What error boundaries show. Server errors reach the browser without their
 * message (Next.js withholds it in production); the digest matches the
 * server's log entry.
 */
export function ErrorMessage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-muted">
        This page couldn&apos;t be loaded. It&apos;s usually temporary, for example when the podcast directory is slow to
        answer.
      </p>
      {/* Re-fetches the page from the server; reset() would only re-render the failed result. */}
      <button onClick={retry} className="mt-6 rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-text">
        Try again
      </button>
      {error.digest && <p className="mt-6 font-mono text-xs text-faint">Reference: {error.digest}</p>}
    </div>
  );
}
