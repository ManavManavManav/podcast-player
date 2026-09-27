import type { AdRange } from "@/lib/types";

/** Who an ad is for: "Ad: Sierra" → "Sierra"; several merged ads read "Ad: A; Ad: B" → "A, B". */
export function advertiser(ad: AdRange): string {
  const names = ad.reason
    .split(";")
    .map((part) => part.trim().replace(/^Ad:?\s*/i, ""))
    .filter(Boolean);
  return names.length ? [...new Set(names)].join(", ") : "Ad";
}
