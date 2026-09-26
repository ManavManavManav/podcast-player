import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublic, type Resolver } from "@/lib/server/safeFetch";

/** A local server standing in for both podcast hosts and internal services. */
let server: http.Server;
let port: number;
let hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.headers.host}${req.url}`);
    if (req.url?.startsWith("/redirect/")) {
      res.writeHead(302, { location: decodeURIComponent(req.url.slice("/redirect/".length)) }).end();
    } else if (req.url === "/loop") {
      res.writeHead(302, { location: "/loop" }).end();
    } else if (req.url === "/audio") {
      if (req.headers.range === "bytes=2-4") {
        res.writeHead(206, { "content-range": "bytes 2-4/10", "content-type": "audio/mpeg" }).end("234");
      } else {
        res.writeHead(200, { "content-type": "audio/mpeg" }).end("0123456789");
      }
    } else if (req.url === "/slow") {
      // Never answers.
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  hits = [];
});

/** Resolves every name to the local server, like a DNS-rebinding attacker would. */
const toLoopback: Resolver = async () => [{ address: "127.0.0.1", family: 4 }];
/** Test-only: treats one fake public name's address (127.0.0.1) as allowed. */
const allowLoopback = () => true;

describe("fetchPublic", () => {
  it("refuses a hostname that resolves to a private address, without connecting", async () => {
    await expect(fetchPublic(`http://rebind.example:${port}/audio`, { resolver: toLoopback })).rejects.toThrow(
      /public/,
    );
    expect(hits).toEqual([]);
  });

  it("refuses if any resolved address is private", async () => {
    const mixed: Resolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(fetchPublic(`http://mixed.example:${port}/audio`, { resolver: mixed })).rejects.toThrow(/public/);
    expect(hits).toEqual([]);
  });

  it("checks the address at connect time, not just once before", async () => {
    // First lookup (e.g. an earlier validation) says public, the next says private.
    let calls = 0;
    const rebinding: Resolver = async () =>
      calls++ === 0 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
    await rebinding("rebind.example"); // what a separate pre-check would have seen
    await expect(fetchPublic(`http://rebind.example:${port}/audio`, { resolver: rebinding })).rejects.toThrow(
      /public/,
    );
    expect(hits).toEqual([]);
  });

  it("refuses private IP literals without connecting", async () => {
    await expect(fetchPublic(`http://127.0.0.1:${port}/audio`)).rejects.toThrow(/public/);
    await expect(fetchPublic(`http://[::ffff:127.0.0.1]:${port}/audio`)).rejects.toThrow(/public/);
    expect(hits).toEqual([]);
  });

  it("refuses non-http(s) URLs", async () => {
    await expect(fetchPublic("file:///etc/passwd")).rejects.toThrow(/http/);
  });

  it("returns the response, passing range requests through", async () => {
    const opts = { resolver: toLoopback, isAllowed: allowLoopback };
    const full = await fetchPublic(`http://host.example:${port}/audio`, opts);
    expect(full.response.status).toBe(200);
    expect(full.response.headers.get("content-type")).toBe("audio/mpeg");
    expect(await full.response.text()).toBe("0123456789");

    const part = await fetchPublic(`http://host.example:${port}/audio`, { ...opts, headers: { Range: "bytes=2-4" } });
    expect(part.response.status).toBe(206);
    expect(part.response.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await part.response.text()).toBe("234");
    expect(hits).toEqual([`host.example:${port}/audio`, `host.example:${port}/audio`]);
  });

  it("follows redirects, checking every hop, and reports the final URL", async () => {
    const opts = { resolver: toLoopback, isAllowed: allowLoopback };
    const target = encodeURIComponent(`http://cdn.example:${port}/audio`);
    const { response, url } = await fetchPublic(`http://feed.example:${port}/redirect/${target}`, opts);
    expect(response.status).toBe(200);
    expect(url).toBe(`http://cdn.example:${port}/audio`);
  });

  it("refuses a redirect to a private address without requesting it", async () => {
    // The first host is allowed; the redirect target is a private literal.
    const target = encodeURIComponent(`http://10.0.0.1:${port}/admin`);
    const onlyFirst = (address: string) => address === "127.0.0.1";
    await expect(
      fetchPublic(`http://feed.example:${port}/redirect/${target}`, { resolver: toLoopback, isAllowed: onlyFirst }),
    ).rejects.toThrow(/public/);
    expect(hits).toEqual([`feed.example:${port}/redirect/${target}`]);
  });

  it("gives up after too many redirects", async () => {
    await expect(
      fetchPublic(`http://loop.example:${port}/loop`, { resolver: toLoopback, isAllowed: allowLoopback }),
    ).rejects.toThrow(/redirects/);
  });

  it("can hand back a redirect instead of following it", async () => {
    const target = encodeURIComponent(`http://cdn.example:${port}/audio`);
    const { response } = await fetchPublic(`http://feed.example:${port}/redirect/${target}`, {
      resolver: toLoopback,
      isAllowed: allowLoopback,
      redirect: "manual",
    });
    expect(response.status).toBe(302);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    const pending = fetchPublic(`http://slow.example:${port}/slow`, {
      resolver: toLoopback,
      isAllowed: allowLoopback,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow(/abort/i);
  });
});

describe("fetchPublic with the end-to-end allow-list", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("connects to a listed host:port even though it's private", async () => {
    vi.stubEnv("PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS", `127.0.0.1:${port}`);
    const { response } = await fetchPublic(`http://127.0.0.1:${port}/audio`);
    expect(response.status).toBe(200);
  });

  it("still refuses a redirect from a listed host to an unlisted private one", async () => {
    vi.stubEnv("PODBLOCK_UNSAFE_ALLOW_AUDIO_HOSTS", `127.0.0.1:${port}`);
    const target = encodeURIComponent(`http://localhost:${port}/audio`);
    await expect(fetchPublic(`http://127.0.0.1:${port}/redirect/${target}`)).rejects.toThrow(/public/);
  });
});
