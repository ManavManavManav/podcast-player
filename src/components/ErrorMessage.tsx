"use client";

import Link from "next/link";
import { StatusPage } from "@/components/StatusPage";
import { Button, buttonStyles } from "@/components/ui/Button";

/**
 * What error boundaries show. Server errors reach the browser without their
 * message (Next.js withholds it in production); the digest matches the
 * server's log entry.
 */
export function ErrorMessage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <StatusPage
      title="Something went wrong"
      actions={
        <>
          {/* Re-fetches the page from the server; reset() would only re-render the failed result. */}
          <Button onClick={retry}>Try again</Button>
          <Link href="/" className={buttonStyles({ variant: "outline" })}>
            Home
          </Link>
        </>
      }
      footnote={error.digest && `Reference: ${error.digest}`}
    >
      This page couldn&apos;t be loaded. It&apos;s usually temporary, for example when the podcast directory is slow to
      answer.
    </StatusPage>
  );
}
