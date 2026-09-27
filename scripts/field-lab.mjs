#!/usr/bin/env node
// The Field lab: a page for trying the Field's studies against real sound
// (lab/index.html, lab/main.ts). A temporary development tool.
//
// Serves the page, bundles lab/main.ts on each request (so edits show on
// reload), and proxies episode links so the browser may analyse their audio
// (most podcast hosts don't allow that cross-origin).
//
// Usage: node scripts/field-lab.mjs [--host 127.0.0.1] [--port 3001]

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import * as esbuild from "esbuild";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const HOST = flag("--host", "127.0.0.1");
const PORT = Number(flag("--port", 3001));

/** Private, loopback and link-local addresses: not for the proxy. */
function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (net.isIPv4(host)) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(host)) return host === "::1" || /^f[cd]/i.test(host) || /^fe80/i.test(host);
  return false;
}

async function proxy(req, res, target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    res.writeHead(400).end("Bad URL");
    return;
  }
  if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) {
    res.writeHead(400).end("Only public http(s) links");
    return;
  }
  const upstream = await fetch(url, { headers: req.headers.range ? { range: req.headers.range } : {}, redirect: "follow" });
  const headers = {};
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  res.writeHead(upstream.status, headers);
  if (upstream.body) Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  else res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://lab");
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(fs.readFileSync("lab/index.html"));
    } else if (url.pathname === "/main.js") {
      const built = await esbuild.build({
        entryPoints: ["lab/main.ts"],
        bundle: true,
        write: false,
        format: "esm",
        target: "es2022",
        tsconfig: "tsconfig.json",
        sourcemap: "inline",
      });
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(built.outputFiles[0].contents);
    } else if (url.pathname === "/proxy") {
      await proxy(req, res, url.searchParams.get("url") ?? "");
    } else {
      res.writeHead(404).end("Not found");
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(err.message ?? err));
  }
});

server.listen(PORT, HOST, () => console.log(`Field lab on http://${HOST}:${PORT}`));
