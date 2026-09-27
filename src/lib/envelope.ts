/** Loudness envelopes (see lib/server/envelope.ts), shared by the server and the browser. */

/** One frame per 50 ms: 20 a second, 6,000 per five-minute window. */
export const ENVELOPE_FRAME_SECONDS = 0.05;
/** The rate windows are decoded at to measure them (the same as sent for transcription). */
export const ENVELOPE_SAMPLE_RATE = 16_000;
/** Bytes per frame: level, low band, high band. */
export const ENVELOPE_BANDS = 3;

/** Base64 envelope → bytes (level, low, high per frame, each 0–255). */
export function decodeEnvelope(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
