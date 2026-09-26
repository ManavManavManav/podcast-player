/**
 * HTTP security headers for every response (set in next.config.ts).
 *
 * The content security policy doesn't use nonces, so inline scripts stay
 * allowed (Next.js's hydration scripts are inline). It still stops the app
 * being framed, plugins, <base> hijacking, forms posting elsewhere, and
 * scripts or API calls to other origins. Audio and artwork come from
 * whatever host a feed names, so media and images may load from anywhere.
 */
export function securityHeaders({ dev }: { dev: boolean }): Array<{ key: string; value: string }> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' blob: https: http:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return [
    // Report-only while it's checked against real use; see PRODUCTION_PLAN.md #9.
    { key: "Content-Security-Policy-Report-Only", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
  ];
}
