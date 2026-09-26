"use client";

import { authClient } from "@/lib/authClient";

export function SignOutButton() {
  const signOut = async () => {
    await authClient.signOut();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };
  return (
    <button
      onClick={signOut}
      className="hover-breathe h-10 rounded-full border border-border px-5 text-sm font-medium hover:bg-surface-2 [--hover-scale:1.04]"
    >
      Sign out
    </button>
  );
}
