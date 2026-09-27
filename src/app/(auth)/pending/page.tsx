import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { currentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Waiting for approval" };
export const dynamic = "force-dynamic";

export default async function PendingPage() {
  // From the database, so "Check again" sees an approval at once.
  const user = await currentUser({ fresh: true });
  if (!user) redirect("/login");
  if (user.approved) redirect("/");

  return (
    <div className="rounded-3xl bg-surface p-6 text-center sm:p-8">
      <h1 className="font-serif text-3xl">Waiting for approval</h1>
      <p className="mt-2 text-sm text-muted">
        Your account ({user.email}) has been created. The server&apos;s owner needs to approve it before you can start
        listening.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link
          href="/"
          className="hover-breathe flex h-11 items-center rounded-full bg-accent px-6 text-sm font-medium text-accent-text [--hover-scale:1.04]"
        >
          Check again
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}
