import { describe, expect, it } from "vitest";
import { advertiser } from "@/lib/ads/label";

const ad = (reason: string) => ({ start: 0, end: 30, confidence: 1, reason });

describe("advertiser", () => {
  it("strips the Ad: prefix", () => expect(advertiser(ad("Ad: Sierra"))).toBe("Sierra"));
  it("lists merged ads once each", () => expect(advertiser(ad("Ad: Acme; Ad: Sierra; Ad: Acme"))).toBe("Acme, Sierra"));
  it("falls back to Ad", () => expect(advertiser(ad(""))).toBe("Ad"));
});
