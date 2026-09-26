import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";

/**
 * The analysis routes make the server fetch URLs and spend API credit, so
 * they must only answer the app itself — not any website the user happens to
 * have open, which could otherwise post to http://localhost:3000.
 *
 * Returns an error response to send, or null if the request is fine.
 */
export function rejectCrossSite(req: NextRequest): NextResponse | null {
  // Requiring JSON makes a cross-site request "non-simple", so the browser
  // must ask permission first (a CORS preflight), which we never grant.
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get("host")) {
        return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
    }
  }
  return null;
}

function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, incl. cloud metadata endpoints
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast and reserved
    );
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** True if the URL's host resolves only to public internet addresses. */
export async function isPublicUrl(url: string): Promise<boolean> {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}
