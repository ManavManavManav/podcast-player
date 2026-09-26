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
      className="hover-breathe h-11 rounded-full border border-accent px-6 text-sm font-medium [--hover-scale:1.04]"
    >
      Sign out
    </button>
  );
}
