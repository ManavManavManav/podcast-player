import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountSettings } from "@/components/settings/AccountSettings";
import { DetectorSettings } from "@/components/settings/DetectorSettings";
import { currentUser } from "@/lib/server/session";
import { getSettings } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings");

  return (
    <div className="mx-auto max-w-2xl space-y-12">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      <DetectorSettings initial={getSettings(user.id)} />
      <AccountSettings name={user.name} email={user.email} />
    </div>
  );
}
