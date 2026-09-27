/**
 * Whether ffmpeg can fast-seek a file (jump to the window by byte offset)
 * without misplacing timestamps. Measured in docs/seek-accuracy.md: exact
 * for constant-bitrate MP3 and for MP4/M4A (indexed); seconds off for
 * variable-bitrate MP3. Decided from the first bytes of the file; anything
 * unrecognized gets the exact, slower read.
 */

/** How many bytes of MP3 frames to look at when there's no Xing/Info tag. */
const FRAMES_SAMPLE = 24 * 1024;
/** Frames that must share one bitrate to call a file constant-bitrate. */
const MIN_FRAMES = 10;

const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Size of a leading ID3v2 tag (with its header and footer), or 0. */
function id3Size(bytes: Buffer): number {
  if (bytes.length < 10 || bytes.toString("latin1", 0, 3) !== "ID3") return 0;
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const footer = bytes[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

/** How much of the file to read, given its first 16 bytes. */
export function headBytesNeeded(first: Buffer): number {
  return id3Size(first) + FRAMES_SAMPLE;
}

interface Frame {
  version: number; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  channelMode: number;
  bitrateIndex: number;
  length: number;
}

/** An MPEG audio Layer III frame header at `at`, or null. */
function frameAt(bytes: Buffer, at: number): Frame | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[at + 1] >> 3) & 3;
  const layer = (bytes[at + 1] >> 1) & 3;
  const bitrateIndex = bytes[at + 2] >> 4;
  const rateIndex = (bytes[at + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const bitrate = (version === 3 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3)[bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const padding = (bytes[at + 2] >> 1) & 1;
  const length = Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return { version, channelMode: bytes[at + 3] >> 6, bitrateIndex, length };
}

export function canFastSeek(head: Buffer): boolean {
  // MP4/M4A: an indexed container; seeking uses the index.
  if (head.length >= 8 && head.toString("latin1", 4, 8) === "ftyp") return true;

  let at = id3Size(head);
  // The first frame: allow a little junk after the tag.
  const limit = Math.min(head.length, at + 4096);
  while (at < limit && !frameAt(head, at)) at++;
  const first = frameAt(head, at);
  if (!first) return false;

  // The first frame may carry an encoder tag: "Info" means constant bitrate,
  // "Xing" or "VBRI" variable.
  const sideInfo = first.version === 3 ? (first.channelMode === 3 ? 17 : 32) : first.channelMode === 3 ? 9 : 17;
  const tag = head.toString("latin1", at + 4 + sideInfo, at + 8 + sideInfo);
  if (tag === "Info") return true;
  if (tag === "Xing" || head.toString("latin1", at + 36, at + 40) === "VBRI") return false;

  // No tag: constant bitrate if the frames all share one.
  let frames = 0;
  for (let frame: Frame | null = first; frame; frame = frameAt(head, at)) {
    if (frame.bitrateIndex !== first.bitrateIndex) return false;
    frames++;
    at += frame.length;
  }
  return frames >= MIN_FRAMES;
}
