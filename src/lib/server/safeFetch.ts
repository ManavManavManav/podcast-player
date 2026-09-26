import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { isPublicAddress } from "@/lib/server/guard";

/**
 * Fetching URLs that users hand us (episode audio) without letting them
 * point the server at itself or its network.
 *
 * Checking a hostname before fetching it isn't enough: the name can resolve
 * to a public address for the check and a private one for the connection
 * (DNS rebinding). So the check runs inside the connection's own DNS lookup,
 * on the addresses actually connected to, and again on every redirect.
 */

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface PublicFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: "GET" | "HEAD";
  /** "follow" (default) re-checks and follows up to 5 redirects; "manual" returns them. */
  redirect?: "follow" | "manual";
  /** Test seams: how names resolve, and which addresses count as public. */
  resolver?: Resolver;
  isAllowed?: (address: string) => boolean;
}

export interface PublicResponse {
  response: Response;
  /** The URL that answered, after redirects. */
  url: string;
}

export class NonPublicAddressError extends Error {
  constructor(host: string) {
    super(`Refusing to fetch ${host}: it must be on a public host`);
    this.name = "NonPublicAddressError";
  }
}

const MAX_REDIRECTS = 5;
const defaultResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true });

export async function fetchPublic(url: string, options: PublicFetchOptions = {}): Promise<PublicResponse> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await requestOnce(new URL(current), options);
    const location = response.headers.get("location");
    if (options.redirect === "manual" || response.status < 300 || response.status >= 400 || !location) {
      return { response, url: current };
    }
    await response.body?.cancel();
    current = new URL(location, current).toString();
  }
  throw new Error("Too many redirects");
}

function requestOnce(url: URL, options: PublicFetchOptions): Promise<Response> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(new Error("Only http(s) URLs can be fetched"));
  }
  const isAllowed = options.isAllowed ?? isPublicAddress;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // Node skips the lookup for IP literals, so check those here.
  if (isIP(host) && !isAllowed(host)) return Promise.reject(new NonPublicAddressError(host));

  const resolver = options.resolver ?? defaultResolver;
  const lookup: LookupFunction = (hostname, lookupOptions, callback) => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          return callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: "ENOTFOUND" }), "", 0);
        }
        if (!addresses.every(({ address }) => isAllowed(address))) {
          return callback(new NonPublicAddressError(hostname), "", 0);
        }
        if (lookupOptions.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };

  return new Promise<Response>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      { method: options.method ?? "GET", headers: options.headers, lookup, signal: options.signal, agent: false },
      (res) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
        }
        const status = res.statusCode ?? 502;
        const empty = options.method === "HEAD" || status === 204 || status === 304;
        if (empty) res.resume();
        resolve(
          new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
            status,
            statusText: res.statusMessage,
            headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
