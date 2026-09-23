/** Small formatting helpers shared by server and client code. */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** Turns an HTML fragment from an RSS feed into readable plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#?\w+);/g, (match, name: string) => {
      if (name in ENTITIES) return ENTITIES[name];
      if (name.startsWith("#")) {
        const code = name[1] === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return match;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const ss = seconds.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${ss}`
    : `${minutes}:${ss}`;
}

/** 3725 → "1 hr 2 min", 540 → "9 min", 40 → "40 sec". */
export function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 0) return "";
  if (totalSeconds < 60) return `${Math.round(totalSeconds)} sec`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

/** Unix seconds → "Mar 4, 2025" (or "Mar 4" within the current year). */
export function formatDate(unixSeconds: number, now = new Date()): string {
  if (!unixSeconds) return "";
  const date = new Date(unixSeconds * 1000);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
