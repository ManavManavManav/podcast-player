import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
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
  if (origin && !isOwnOrigin(origin, req)) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }
  return null;
}

/**
 * The addresses this site is reached at: the Host header, the host a proxy
 * says it forwarded for, and the configured public URL and trusted origins
 * (the same ones sign-in accepts).
 */
function isOwnOrigin(origin: string, req: NextRequest): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host")?.split(",")[0].trim()];
  if (hosts.includes(url.host)) return true;
  const configured = [process.env.BETTER_AUTH_URL, ...(process.env.PODBLOCK_TRUSTED_ORIGINS?.split(",") ?? [])];
  return configured.some((entry) => {
    try {
      return Boolean(entry?.trim()) && new URL(entry!.trim()).origin === url.origin;
    } catch {
      return false;
    }
  });
}

/** IPv4 ranges that aren't the public internet (IANA special-purpose registry). */
const PRIVATE_V4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata endpoints
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 3], // multicast, reserved, broadcast
] as const) {
  PRIVATE_V4.addSubnet(network, prefix, "ipv4");
}

/** Special-purpose ranges inside global unicast (2000::/3) that aren't reachable hosts. */
const PRIVATE_V6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 32], // Teredo: tunnels to an IPv4 host
  ["2001:2::", 48], // benchmarking
  ["2001:10::", 28], // ORCHID
  ["2001:20::", 28], // ORCHIDv2
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: tunnels to an IPv4 host
] as const) {
  PRIVATE_V6.addSubnet(network, prefix, "ipv6");
}

/** An IPv6 address as eight 16-bit groups, or null if it doesn't parse. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  // A trailing dotted IPv4 (e.g. ::ffff:1.2.3.4) is two groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[2]) !== 4) return null;
    const [a, b, c, d] = dotted[2].split(".").map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((g) => parseInt(g, 16)) : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...tail];
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4FromGroups = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * True only for addresses on the public internet. IPv4 addresses embedded
 * in IPv6 (mapped, compatible, NAT64) are judged by the IPv4 address, since
 * connecting to them reaches it.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !PRIVATE_V4.check(address, "ipv4");
  if (family !== 6) return false;

  const g = ipv6Groups(address);
  if (!g) return false;
  const firstFive = g.slice(0, 5).every((x) => x === 0);
  const mapped = firstFive && g[5] === 0xffff; // ::ffff:0:0/96
  const compatible = firstFive && g[5] === 0; // ::/96, incl. :: and ::1
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0); // 64:ff9b::/96
  if (mapped || compatible || nat64) return isPublicAddress(v4FromGroups(g[6], g[7]));

  // Everything outside global unicast (2000::/3) is local, multicast or
  // reserved: ::1, fc00::/7, fe80::/10, fec0::/10, ff00::/8, 64:ff9b:1::/48…
  if ((g[0] & 0xe000) !== 0x2000) return false;
  return !PRIVATE_V6.check(address, "ipv6");
}

/** True if the URL's host resolves only to public internet addresses. */
export async function isPublicUrl(url: string): Promise<boolean> {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address));
  } catch {
    return false;
  }
}
