"use client";

import { authClient } from "@/lib/authClient";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  const signOut = async () => {
    await authClient.signOut();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };
  return (
    <Button variant="outline" onClick={signOut}>
      Sign out
    </Button>
  );
}
