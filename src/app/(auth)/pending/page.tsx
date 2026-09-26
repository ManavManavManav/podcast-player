import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { currentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Waiting for approval" };
export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.approved) redirect("/");

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-card sm:p-7">
      <h1 className="text-lg font-semibold">Waiting for approval</h1>
      <p className="mt-2 text-sm text-muted">
        Your account ({user.email}) has been created. The server&apos;s owner needs to approve it before you can start
        listening.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link
          href="/"
          className="hover-breathe flex h-10 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-text [--hover-scale:1.04]"
        >
          Check again
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}
