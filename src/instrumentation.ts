/** Runs once when a server instance starts (see node_modules/next/dist/docs, instrumentation). */
export async function register() {
  // Also compiled for the Edge runtime, so Node-only code is loaded only here.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkConfiguration } = await import("@/lib/server/startupCheck");
    checkConfiguration();
  }
}
