import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { listUsers } from "@/lib/server/admin";
import { currentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted">
          New accounts can&apos;t listen until you approve them. Usage is this month&apos;s paid API work.
        </p>
      </div>
      <AdminPanel initial={await listUsers()} selfId={user.id} />
    </div>
  );
}
