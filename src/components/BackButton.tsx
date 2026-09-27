"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/** Goes back a page, or home when there's nothing to go back to (a link opened in a new tab). */
export function BackButton() {
  const router = useRouter();
  return (
    <Button variant="outline" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}>
      <ArrowLeft className="size-4" aria-hidden="true" /> Back
    </Button>
  );
}
