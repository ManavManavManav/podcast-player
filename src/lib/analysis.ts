/** Constants shared by the analysis API and the in-browser scanner. */

/**
 * Episodes are transcribed and checked for ads in fixed windows of this many
 * seconds, on a grid shared by every listener. Five minutes keeps each call
 * to the ad detector well worth its fixed overhead (instructions, context)
 * while still answering within seconds.
 */
export const WINDOW_SECONDS = 300;

/** How many windows ahead of the playhead the player keeps analyzed. */
export const LOOKAHEAD_WINDOWS = 1;

export function windowStartFor(seconds: number): number {
  return Math.max(0, Math.floor(seconds / WINDOW_SECONDS) * WINDOW_SECONDS);
}

/** "en-US" → "en". Whisper wants bare ISO-639-1 codes. */
export function whisperLanguage(feedLanguage: string | undefined): string | undefined {
  const code = feedLanguage?.trim().toLowerCase().split(/[-_]/)[0];
  return code && /^[a-z]{2}$/.test(code) ? code : undefined;
}
