/**
 * Where to send someone after signing in: only a path on this site, so a
 * crafted link can't bounce them to another one. Browsers read `\` as `/`
 * and drop tabs and newlines, so `/\evil.com` would otherwise mean
 * `//evil.com`.
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  const base = "http://same.invalid";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return "/";
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Dot segments can collapse to a protocol-relative "//host".
  if (url.origin !== base || path.startsWith("//")) return "/";
  return path;
}
