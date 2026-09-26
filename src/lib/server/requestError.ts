import type { Instrumentation } from "next";
import { log } from "@/lib/server/log";

/**
 * Unhandled errors from rendering pages and running routes, in the
 * structured log. The digest is what the error page shows as "Reference",
 * so a listener's report can be matched to the log entry.
 */
export function logRequestError(...[err, request, context]: Parameters<Instrumentation.onRequestError>) {
  const header = request.headers["x-request-id"] ?? request.headers["x-vercel-id"];
  log.error("request.error", {
    digest: typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined,
    method: request.method,
    path: request.path,
    route: context.routePath,
    routeType: context.routeType,
    // Outside any request context, so carry the id over by hand.
    requestId: Array.isArray(header) ? header[0] : header,
    err,
  });
}
