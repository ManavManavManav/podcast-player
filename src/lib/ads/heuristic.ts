import type { AdRange, TranscriptSegment } from "@/lib/types";
import { mergeRanges, snapToSpeech } from "@/lib/ads/merge";

/**
 * Offline ad detector: finds sponsor reads and inserted ads in a transcript
 * using phrase signals, then groups nearby signals into ad ranges.
 *
 * Rather than matching segment-by-segment, all segments are joined into one
 * string and matches are mapped back to time by character offset. Whisper
 * often splits a phrase ("today's episode / is brought to you by") across
 * segments or window boundaries, and the offset mapping also gives
 * sub-segment precision for where a read begins.
 */

type SignalKind =
  /** Announces a sponsor read ("brought to you by"). The ad starts at the match. */
  | "intro"
  /** "When we come back from the break". The ad starts after this sentence. */
  | "break"
  /** Something ads say and shows rarely do (promo codes, disclaimers, URLs). */
  | "pitch";

interface Signal {
  kind: SignalKind;
  weight: number;
  pattern: RegExp;
  label: string;
}

const NUM = String.raw`(?:\d+|one|two|three|four|five|ten|fifteen|twenty|twenty[- ]five|thirty|forty|fifty|sixty)`;
const TLD = String.raw`(?:com|org|net|co|io|ai|fm|tv|us|app)`;

// Patterns run over lowercased text with curly quotes normalized.
const SIGNALS: Signal[] = [
  // --- Sponsor introductions ---
  {
    kind: "intro",
    weight: 5,
    label: "“brought to you by”",
    pattern: /\b(?:is|are|was|were|been|also|episode|show|podcast)?\s*brought to (?:you|us)\b(?: today)? by\b/g,
  },
  {
    kind: "intro",
    weight: 5,
    label: "sponsor mention",
    pattern:
      /\b(?:this|today's|the|our) (?:episode|show|podcast|segment|portion|hour|week's episode)(?: is| was)?(?: also)? (?:sponsored|presented|supported|powered|made possible) by\b/g,
  },
  {
    kind: "intro",
    weight: 5,
    label: "“support comes from”",
    pattern: /\bsupport (?:for|of) (?:this|the|today's) (?:show|podcast|episode|program)\b.{0,40}?\bcomes? from\b/g,
  },
  {
    kind: "intro",
    weight: 5,
    label: "sponsor thanks",
    pattern:
      /\b(?:thank|thanks to|shout out to|i'd like to thank) (?:our|today's|this week's|this episode's|the) (?:first |second |third |next |final |last |brand new |new )?(?:presenting )?(?:sponsors?|partners?)\b|\bour (?:first|second|third|next|final|last) sponsor\b|\ba (?:quick )?word from (?:our|today's) sponsors?\b/g,
  },
  {
    kind: "intro",
    weight: 4,
    label: "sponsor mention",
    pattern: /\b(?:sponsored|presented|paid for|underwritten) by\b/g,
  },
  {
    kind: "intro",
    weight: 4,
    label: "partnership",
    pattern: /\b(?:we've|we have|we're proud to have|proud to announce that we've) partnered with\b|\bin partnership with\b/g,
  },

  // --- Break markers ---
  {
    kind: "break",
    weight: 5,
    label: "break announcement",
    pattern:
      /\b(?:(?:when|after) we (?:come|get) back|(?:right )?after (?:the|this|a) (?:short |quick )?break|(?:take|taking) (?:a|our) (?:short |quick |little )?break|we'll be right back|stay with us|back (?:right )?after (?:this|these)(?: messages?)?|a (?:quick|short) break)\b/g,
  },

  // --- Pitches, calls to action and legal copy ---
  {
    kind: "pitch",
    weight: 4,
    label: "promo code",
    pattern: /\b(?:promo|offer|discount|coupon) code\b|\b(?:use|enter|with) (?:the )?code\b/g,
  },
  {
    kind: "pitch",
    weight: 4,
    label: "promo link",
    pattern: new RegExp(String.raw`\b[a-z0-9-]{2,}\s?(?:\.|dot)\s?${TLD}\s?(?:/|slash)\s?[a-z0-9]`, "g"),
  },
  {
    kind: "pitch",
    weight: 5,
    label: "repeated web address",
    // "That's example.com" / "Again, that's example.com slash show": ads
    // spell their URL twice; conversation almost never does.
    pattern: new RegExp(String.raw`\b(?:that's|again,? that's|once again,?|again, it's|again, go to) [a-z0-9-]{2,}\s?(?:\.|dot)\s?${TLD}\b`, "g"),
  },
  {
    kind: "pitch",
    weight: 2,
    label: "web address",
    pattern: new RegExp(String.raw`\b[a-z0-9-]{2,}\s?(?:\.|\bdot\b)\s?${TLD}\b`, "g"),
  },
  {
    kind: "pitch",
    weight: 4,
    label: "legal disclaimer",
    pattern:
      /\b(?:terms|restrictions|exclusions|conditions|fees)(?: and (?:conditions|limitations|restrictions))? (?:may )?apply\b|\bsee (?:site|store|[a-z0-9-]+ ?(?:\.|dot) ?com)? ?for (?:full )?details\b|\bvary by state\b|\bnot available in (?:all|every) (?:states?|areas?)\b|\bmember fdic\b|\bnot a bank\b|\bno purchase necessary\b|\bvoid where prohibited\b|\bmust be (?:18|21)\b|\bgambling problem\b|\bsubject to (?:credit approval|approval|terms)\b|\bterms and qualifications\b|\binsurance (?:sold|offered|underwritten) by\b|\binsurance company and affiliates\b|\bads? (?:are|is) selected\b/g,
  },
  {
    kind: "pitch",
    weight: 4,
    label: "ad copy",
    // Lines lifted from display or radio ads.
    pattern:
      /\b(?:click|tap) (?:the|this) (?:banner|ad)\b|\bat (?:your|a) (?:local |nearest |participating )?[a-z]+ (?:dealer|dealership|retailer)s?\b|\bat participating (?:locations|restaurants|stores)\b|\bwherever (?:you get your )?podcasts? (?:are|is)? ?(?:available|sold)\b/g,
  },
  {
    kind: "pitch",
    weight: 3,
    label: "special offer",
    pattern: new RegExp(
      String.raw`\b${NUM} ?(?:%|percent) off\b|\b(?:free|risk[- ]free|no[- ]risk) (?:trial|shipping|gift|month|week)s?\b|\bfirst (?:month|order|box|year) (?:free|for)\b|\bmoney[- ]back guarantee\b|\blimited[- ]time (?:offer|only)\b|\b(?:exclusive|special) (?:offer|deal|discount)s?\b|\bcash ?back\b|\bsave (?:up to |an average of )?(?:\$|hundreds\b|${NUM} ?(?:%|dollars|percent))|\$\d[\d,]* (?:credit|off|gift card)\b`,
      "g",
    ),
  },
  {
    kind: "pitch",
    weight: 2,
    label: "call to action",
    pattern:
      /\b(?:head|go|visit|check out) (?:over )?(?:to )?[a-z0-9-]+ ?(?:\.|dot) ?(?:com|org|net|co|io)\b|\b(?:sign up|get started|download|order|shop|try it|join|book|switch|apply) (?:today|now|at|for free)\b|\badvertise on [a-z]+\b|\bdownload the [a-z0-9 ]{1,20} app\b|\bavailable (?:now )?(?:on|in) the app store\b|\blink in (?:the|our) (?:show notes|description)\b|\b\$\d[\d,]* (?:a|per) month\b|\bper month\b/g,
  },
];

/** Pitches closer than this (seconds) belong to the same ad. */
const MAX_GAP = 45;
/**
 * A sponsor read can talk about the product for a minute or more between
 * "brought to you by" and its call to action.
 */
const LEAD_GAP = 100;
/** A cluster needs this much total evidence to count as an ad. */
const MIN_SCORE = 7;
const MIN_DURATION = 6;
/** Pitch kinds about buying something, as opposed to just visiting a site. */
const COMMERCIAL_LABELS = new Set(["special offer", "legal disclaimer", "promo code", "ad copy"]);
/** Pitch kinds that essentially never occur outside an ad. */
const AD_ONLY_LABELS = new Set(["ad copy", "legal disclaimer", "promo code"]);
/** How close (seconds) a weak snippet must be to a confirmed ad to join it. */
const ADJACENT = 5;
export interface DetectOptions {
  /**
   * Names of the show's own sites ("acquired" for acquired.fm). A host
   * plugging their own website, newsletter or Slack isn't advertising.
   */
  ownSites?: string[];
}

/** "https://www.acquired.fm/episodes" → "acquired". */
export function siteName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, "").split(".");
    return labels.length >= 2 ? labels.at(-2)! : null;
  } catch {
    return null;
  }
}

/** Whisper often mangles names ("acquire.fm"), so allow a small edit distance. */
function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const allowed = Math.min(a.length, b.length) >= 8 ? 2 : 1;
  if (Math.abs(a.length - b.length) > allowed) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] <= allowed;
}

const URL_NAME = new RegExp(String.raw`([a-z0-9-]{2,})\s?(?:\.|\bdot\b)\s?${TLD}\b`);

/** True if the matched text names one of the show's own sites. */
function mentionsOwnSite(text: string, ownSites: string[]): boolean {
  const name = URL_NAME.exec(text)?.[1]?.replace(/-/g, "");
  return Boolean(name) && ownSites.some((own) => similar(name!, own));
}

export interface Hit {
  kind: SignalKind;
  weight: number;
  label: string;
  /** Episode time where the matched text begins/ends (seconds). */
  start: number;
  end: number;
  /** Start/end of the segments containing the match. */
  segmentStart: number;
  segmentEnd: number;
}

interface IndexedText {
  text: string;
  /** For each segment, the [start, end) character range in `text`. */
  spans: Array<{ from: number; to: number; segment: TranscriptSegment }>;
}

/** Joins sorted segments; a visible break separates non-contiguous audio. */
function indexSegments(segments: TranscriptSegment[]): IndexedText {
  let text = "";
  const spans: IndexedText["spans"] = [];
  let previousEnd = -Infinity;
  for (const segment of segments) {
    // A seek leaves holes in what's been transcribed; don't let a phrase
    // "match" across one.
    text += segment.start - previousEnd > 5 ? " ¶ " : " ";
    const normalized = segment.text.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
    spans.push({ from: text.length, to: text.length + normalized.length, segment });
    text += normalized;
    previousEnd = segment.end;
  }
  return { text, spans };
}

/** Maps a character offset to a time, interpolating inside the segment. */
function locate(index: IndexedText, offset: number) {
  let lo = 0;
  let hi = index.spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.spans[mid].from <= offset) lo = mid;
    else hi = mid - 1;
  }
  const span = index.spans[lo];
  const { segment } = span;
  const fraction = Math.min(1, Math.max(0, (offset - span.from) / Math.max(1, span.to - span.from)));
  return { segment, time: segment.start + fraction * (segment.end - segment.start) };
}

/** Offset of the start of the sentence containing `offset` (looks back ≤ 80 chars). */
function sentenceStart(text: string, offset: number): number {
  const floor = Math.max(0, offset - 80);
  for (let i = offset - 1; i >= floor; i--) {
    const ch = text[i];
    if (ch === "¶") return i + 2;
    if ((ch === "." || ch === "?" || ch === "!") && /\s/.test(text[i + 1] ?? "")) {
      let j = i + 1;
      while (j < offset && /\s/.test(text[j])) j++;
      return j;
    }
  }
  return offset;
}

export function findHits(segments: TranscriptSegment[], options: DetectOptions = {}): Hit[] {
  const ownSites = (options.ownSites ?? []).map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return [];
  const index = indexSegments(sorted);
  const hits: Hit[] = [];

  for (const signal of SIGNALS) {
    for (const match of index.text.matchAll(signal.pattern)) {
      let fromOffset = match.index + (match[0].length - match[0].trimStart().length);
      // "Today's episode is brought to you by": the ad starts with the sentence.
      if (signal.kind === "intro") fromOffset = sentenceStart(index.text, fromOffset);
      const toOffset = match.index + match[0].length;
      const matched = index.text.slice(fromOffset, toOffset);
      if (matched.includes("¶")) continue;
      if (signal.kind === "pitch" && ownSites.length && mentionsOwnSite(matched, ownSites)) continue;
      const from = locate(index, fromOffset);
      const to = locate(index, Math.max(fromOffset, toOffset - 1));
      hits.push({
        kind: signal.kind,
        weight: signal.weight,
        label: signal.label,
        start: from.time,
        end: to.time,
        segmentStart: from.segment.start,
        segmentEnd: to.segment.end,
      });
    }
  }

  // A plain URL match inside a URL-with-path match is the same evidence.
  return dedupe(hits.sort((a, b) => a.start - b.start));
}

function dedupe(hits: Hit[]): Hit[] {
  const result: Hit[] = [];
  for (const hit of hits) {
    const overlapping = result.find(
      (h) => h.kind === hit.kind && h.start <= hit.end && hit.start <= h.end,
    );
    if (!overlapping) result.push(hit);
    else if (hit.weight > overlapping.weight) Object.assign(overlapping, hit);
  }
  return result;
}

/**
 * Where an ad starts. Lead-ins before the first pitch decide it: an ad starts
 * after the last "we'll be right back", or at the first sponsor introduction
 * that follows it. Without a lead-in, pitch lines are rarely the first thing
 * in an ad, so the whole segment of the first one is included.
 */
function clusterStart(cluster: Hit[]): number {
  const firstPitch = cluster.findIndex((h) => h.kind === "pitch");
  const leads = cluster.slice(0, firstPitch === -1 ? cluster.length : firstPitch);
  if (leads.length === 0) return cluster[0].segmentStart;

  const breaks = leads.filter((h) => h.kind === "break");
  const afterBreak = breaks.length ? Math.max(...breaks.map((h) => h.segmentEnd)) : -Infinity;
  const intros = leads.filter((h) => h.kind === "intro" && h.start >= afterBreak);
  return intros.length ? Math.min(...intros.map((h) => h.start)) : afterBreak;
}

export function detectAds(segments: TranscriptSegment[], options: DetectOptions = {}): AdRange[] {
  const hits = findHits(segments, options);
  const ranges: AdRange[] = [];

  let cluster: Hit[] = [];
  /** Clusters too thin to be ads on their own. */
  const weak: Array<{ start: number; end: number; adOnly: boolean }> = [];
  const flush = () => {
    if (cluster.length === 0) return;
    const score = cluster.reduce((sum, h) => sum + h.weight, 0);
    const pitches = cluster.filter((h) => h.kind === "pitch");
    const hasLead = cluster.some((h) => h.kind !== "pitch");
    // A lone break marker or sponsor mention with no pitch is just talk
    // ("we'll get to that after the break"). Without one, it takes more than
    // one kind of evidence, including something commercial: a host plugging a
    // guest's website ("again, that's example.com") isn't an ad.
    const distinctPitches = new Set(pitches.map((h) => h.label)).size;
    const commercial = pitches.some((h) => COMMERCIAL_LABELS.has(h.label));
    const convincing =
      score >= MIN_SCORE && (hasLead ? pitches.length >= 1 : distinctPitches >= 2 && commercial);

    if (!convincing && pitches.length > 0) {
      weak.push({
        start: clusterStart(cluster),
        end: Math.max(...pitches.map((h) => h.segmentEnd)),
        adOnly: pitches.some((h) => AD_ONLY_LABELS.has(h.label)),
      });
    }
    if (convincing) {
      const start = clusterStart(cluster);
      const lastPitch = pitches.at(-1);
      const end = Math.max(
        lastPitch ? lastPitch.segmentEnd : 0,
        ...cluster.filter((h) => h.kind === "intro").map((h) => h.segmentEnd),
      );
      if (end > start) {
        ranges.push({
          start: round(start),
          end: round(end),
          confidence: Math.min(1, round(score / 16)),
          reason: summarize(cluster),
        });
      }
    }
    cluster = [];
  };

  for (const hit of hits) {
    const last = cluster.at(-1);
    if (last) {
      const hasPitch = cluster.some((h) => h.kind === "pitch");
      const hasLead = cluster.some((h) => h.kind !== "pitch");
      const limit = hasLead && !hasPitch ? LEAD_GAP : MAX_GAP;
      // Measure from where the previous hit's segment ended, so a long
      // Whisper segment doesn't make its neighbours look far apart.
      if (hit.start - Math.max(last.segmentEnd, last.end) > limit) flush();
      // A lead-in after pitches starts a new ad. Pod merging joins the two
      // back up if they're adjacent, and pitches that came before a lead-in
      // (a guest's website plug) are judged on their own.
      else if (hit.kind !== "pitch" && hasPitch) flush();
    }
    cluster.push(hit);
  }
  flush();

  // Ads in a back-to-back pod are one break; merging before the length check
  // keeps an ad whose only evidence was its closing line.
  const merged = mergeRanges(ranges);

  // A thin ad-like snippet directly touching a confirmed ad belongs to the
  // same break: a URL-less brand spot before a sponsor read, or a short
  // inserted ad after one. Before an ad, only language shows don't use counts;
  // hosts often plug a guest's website right before going to sponsors.
  for (const range of merged) {
    for (const snippet of weak) {
      const before = snippet.start < range.start && snippet.end >= range.start - ADJACENT;
      const after = snippet.end > range.end && snippet.start <= range.end + ADJACENT;
      if (before && snippet.adOnly) range.start = snippet.start;
      if (after) range.end = snippet.end;
    }
  }

  return snapToSpeech(
    mergeRanges(merged).filter((r) => r.end - r.start >= MIN_DURATION),
    segments,
  );
}

function summarize(cluster: Hit[]): string {
  const labels = [...new Set(cluster.map((h) => h.label))];
  return labels.slice(0, 3).join(", ");
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
