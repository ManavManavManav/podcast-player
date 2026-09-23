import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isPublicUrl, rejectCrossSite } from "@/lib/server/guard";

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
  ])("rejects %s", async (url) => {
    expect(await isPublicUrl(url)).toBe(false);
  });

  it("accepts a public IP", async () => {
    expect(await isPublicUrl("https://1.1.1.1/a.mp3")).toBe(true);
  });
});
