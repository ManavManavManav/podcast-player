import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicAddress, isPublicUrl, rejectCrossSite } from "@/lib/server/guard";

function post(headers: Record<string, string>) {
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { host: "localhost:3000", ...headers },
    body: "{}",
  });
}

describe("rejectCrossSite", () => {
  it("accepts the app's own JSON requests", () => {
    expect(
      rejectCrossSite(
        post({
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBeNull();
  });

  it("refuses non-JSON bodies, which a cross-site form or no-cors fetch could send", async () => {
    const res = rejectCrossSite(post({ "content-type": "text/plain" }));
    expect(res?.status).toBe(415);
  });

  it("refuses requests from other sites", () => {
    expect(
      rejectCrossSite(post({ "content-type": "application/json", "sec-fetch-site": "cross-site" }))?.status,
    ).toBe(403);
    expect(
      rejectCrossSite(post({ "content-type": "application/json", origin: "https://evil.example" }))?.status,
    ).toBe(403);
  });
});

describe("rejectCrossSite behind a proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // e.g. `tailscale serve` or nginx forwarding to localhost:3000 with the Host rewritten.
  const proxied = (origin: string, extra: Record<string, string> = {}) =>
    rejectCrossSite(post({ "content-type": "application/json", origin, ...extra }));

  it("accepts the site's configured addresses", () => {
    vi.stubEnv("PODBLOCK_TRUSTED_ORIGINS", "https://podblock.example.com, http://100.92.248.74:3001");
    expect(proxied("https://podblock.example.com")).toBeNull();
    expect(proxied("http://100.92.248.74:3001")).toBeNull();
    vi.stubEnv("PODBLOCK_TRUSTED_ORIGINS", "");
    vi.stubEnv("BETTER_AUTH_URL", "https://listen.example.org");
    expect(proxied("https://listen.example.org")).toBeNull();
  });

  it("accepts the host the proxy says it forwarded for", () => {
    expect(proxied("https://podblock.example.com", { "x-forwarded-host": "podblock.example.com" })).toBeNull();
  });

  it("still refuses everything else", () => {
    vi.stubEnv("PODBLOCK_TRUSTED_ORIGINS", "https://podblock.example.com");
    vi.stubEnv("BETTER_AUTH_URL", "https://podblock.example.com");
    expect(proxied("https://evil.example")?.status).toBe(403);
    // Same host, other scheme or port: a different origin.
    expect(proxied("http://podblock.example.com")?.status).toBe(403);
    expect(proxied("https://podblock.example.com:8443")?.status).toBe(403);
    expect(proxied("https://evil.example", { "x-forwarded-host": "podblock.example.com" })?.status).toBe(403);
  });
});

describe("isPublicUrl", () => {
  it.each([
    "http://127.0.0.1/a.mp3",
    "http://localhost:8080/a.mp3",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/a.mp3",
    "http://192.168.1.10/a.mp3",
    "http://172.20.0.1/a.mp3",
    "http://[::1]/a.mp3",
    "http://[fd00::1]/a.mp3",
    "not a url",
    // IPv4 addresses embedded in IPv6: the URL parser rewrites these to hex
    // (e.g. [::ffff:7f00:1]), and connecting to them reaches the IPv4 host.
    "http://[::ffff:127.0.0.1]/a.mp3",
    "http://[::ffff:7f00:1]/a.mp3",
    "http://[::ffff:169.254.169.254]/latest/meta-data",
    "http://[::ffff:10.0.0.1]/a.mp3",
    "http://[::127.0.0.1]/a.mp3", // IPv4-compatible (deprecated)
    "http://[64:ff9b::7f00:1]/a.mp3", // NAT64
    "http://[64:ff9b:1::a00:1]/a.mp3", // NAT64 local-use
    "http://[2002:7f00:1::]/a.mp3", // 6to4
    "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/a.mp3", // Teredo
    // Other IPv6 special-purpose ranges
    "http://[::]/a.mp3",
    "http://[fec0::1]/a.mp3", // site-local
    "http://[febf::1]/a.mp3", // still link-local (fe80::/10)
    "http://[ff02::1]/a.mp3", // multicast
    "http://[2001:db8::1]/a.mp3", // documentation
    // IPv4 special-purpose ranges
    "http://198.18.0.1/a.mp3", // benchmarking
    "http://192.0.0.8/a.mp3", // IETF protocol assignments
    "http://192.0.2.1/a.mp3", // TEST-NET-1
    "http://198.51.100.7/a.mp3", // TEST-NET-2
    "http://203.0.113.9/a.mp3", // TEST-NET-3
    "http://240.0.0.1/a.mp3", // reserved
    "http://255.255.255.255/a.mp3",
    // Alternative IPv4 spellings, normalized by the URL parser
    "http://0x7f000001/a.mp3",
    "http://2130706433/a.mp3",
    "http://127.1/a.mp3",
  ])("rejects %s", async (url) => {
    expect(await isPublicUrl(url)).toBe(false);
  });

  it.each([
    "https://1.1.1.1/a.mp3",
    "https://[2606:4700:4700::1111]/a.mp3",
    "https://[::ffff:1.1.1.1]/a.mp3", // a mapped public address is still public
    "https://172.32.0.1/a.mp3", // just outside 172.16.0.0/12
    "https://100.128.0.1/a.mp3", // just outside 100.64.0.0/10
  ])("accepts public address %s", async (url) => {
    expect(await isPublicUrl(url)).toBe(true);
  });
});

describe("isPublicAddress", () => {
  it.each(["", "localhost", "1::2::3", "gggg::1", "1:2:3:4:5:6:7:8:9", "::ffff:999.1.1.1", "1.2.3"])(
    "rejects malformed %j",
    (address) => {
      expect(isPublicAddress(address)).toBe(false);
    },
  );

  it("handles the forms DNS lookups return", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::FFFF:7F00:1")).toBe(false);
    expect(isPublicAddress("2a00:1450:4001:80b::200e")).toBe(true);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
  });
});

describe("audio host allow-list (for end-to-end tests)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets exactly the listed host:port pairs through", async () => {
    vi.stubEnv("PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS", "127.0.0.1:4010, localhost:4011");
    expect(await isPublicUrl("http://127.0.0.1:4010/episode.mp3")).toBe(true);
    expect(await isPublicUrl("http://localhost:4011/episode.mp3")).toBe(true);
    // Same address, other port; other private hosts: still refused.
    expect(await isPublicUrl("http://127.0.0.1:4012/episode.mp3")).toBe(false);
    expect(await isPublicUrl("http://127.0.0.1/episode.mp3")).toBe(false);
    expect(await isPublicUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
  });

  it("is off unless set", async () => {
    expect(await isPublicUrl("http://127.0.0.1:4010/episode.mp3")).toBe(false);
  });
});
