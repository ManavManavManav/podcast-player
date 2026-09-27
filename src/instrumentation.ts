import type { Instrumentation } from "next";

/** Runs once when a server instance starts (see node_modules/next/dist/docs, instrumentation). */
export async function register() {
  // Also compiled for the Edge runtime, so Node-only code is loaded only here.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkConfiguration } = await import("@/lib/server/startupCheck");
    checkConfiguration();
  }
}

/** Errors thrown while rendering or in routes, into the server log. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logRequestError } = await import("@/lib/server/requestError");
    logRequestError(...args);
  }
};
