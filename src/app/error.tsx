"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-muted">
        We couldn&apos;t reach the podcast directory. If this keeps happening, check the Podcast Index API
        keys in <code className="text-text">.env.local</code>.
      </p>
      <button onClick={reset} className="mt-6 rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-text">
        Try again
      </button>
    </div>
  );
}
