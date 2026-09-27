# Seek accuracy and cost of window extraction

How precisely, and how cheaply, the analyzer's ffmpeg call (`src/lib/server/audio.ts`) extracts a window from a remote episode. Reproduce with `node scripts/seek-accuracy.mjs [--ffmpeg PATH]`. Measured 2026-09-26.

**Method.** A 20-minute fixture: pink noise alternating loud and quiet every 10 s (so VBR bitrates vary), with 0.2 s beeps at 3 kHz at 305 s and 905 s. It is encoded six ways and served over HTTP with range support. A 10 s window starting 5 s before each beep is extracted with the app's own ffmpeg arguments, then decoded, and the beep is located (Goertzel, 10 ms frames). **Error** = where the beep lands minus 5 s. Positive means the window started early, so an ad would be reported later than it is heard. **Read** is ffmpeg's own count of bytes read for the later window.

## The previously bundled ffmpeg (2018 static build)

| Encoding | File size | Seeking | Error at 305 s | Error at 905 s | Read for the later window | Requests |
|---|---|---|---|---|---|---|
| MP3 CBR 128k | 19.2 MB | default (current) | +0.00 s | +0.00 s | 14.6 MB | 1 |
| MP3 CBR 128k | 19.2 MB | fast (-fflags +fastseek) | +0.00 s | -0.03 s | 204 KB | 2 |
| MP3 CBR 128k + cover art in ID3 | 19.3 MB | default (current) | +0.00 s | +0.00 s | 14.7 MB | 1 |
| MP3 CBR 128k + cover art in ID3 | 19.3 MB | fast (-fflags +fastseek) | +0.00 s | -0.03 s | 299 KB | 2 |
| MP3 VBR with TOC (Xing) | 15.8 MB | default (current) | +0.00 s | +0.00 s | 12.0 MB | 1 |
| MP3 VBR with TOC (Xing) | 15.8 MB | fast (-fflags +fastseek) | +0.05 s | +2.09 s | 358 KB | 2 |
| MP3 VBR without TOC | 15.8 MB | default (current) | +0.03 s | +0.03 s | 12.0 MB | 1 |
| MP3 VBR without TOC | 15.8 MB | fast (-fflags +fastseek) | -4.93 s | -4.92 s | 204 KB | 2 |
| M4A AAC, index first (faststart) | 19.5 MB | default (current) | +0.00 s | +0.00 s | 408 KB | 2 |
| M4A AAC, index first (faststart) | 19.5 MB | fast (-fflags +fastseek) | +0.00 s | +0.00 s | 408 KB | 2 |
| M4A AAC, index last | 19.5 MB | default (current) | +0.00 s | +0.00 s | 383 KB | 4 |
| M4A AAC, index last | 19.5 MB | fast (-fflags +fastseek) | +0.00 s | +0.00 s | 383 KB | 4 |

## ffmpeg 7.0.2 (static build; what the app ships since #11, via `ffmpeg-static`)

| Encoding | File size | Seeking | Error at 305 s | Error at 905 s | Read for the later window | Requests |
|---|---|---|---|---|---|---|
| MP3 CBR 128k | 19.2 MB | default (current) | +0.00 s | +0.00 s | 14.6 MB | 2 |
| MP3 CBR 128k | 19.2 MB | fast (-fflags +fastseek) | +0.00 s | -0.03 s | 219 KB | 2 |
| MP3 CBR 128k + cover art in ID3 | 19.2 MB | default (current) | +0.00 s | +0.00 s | 14.6 MB | 1 |
| MP3 CBR 128k + cover art in ID3 | 19.2 MB | fast (-fflags +fastseek) | +0.00 s | -0.03 s | 213 KB | 2 |
| MP3 VBR with TOC (Xing) | 15.8 MB | default (current) | +0.00 s | +0.00 s | 12.1 MB | 2 |
| MP3 VBR with TOC (Xing) | 15.8 MB | fast (-fflags +fastseek) | +0.10 s | +2.01 s | 363 KB | 2 |
| MP3 VBR without TOC | 15.8 MB | default (current) | +0.03 s | +0.03 s | 12.1 MB | 3 |
| MP3 VBR without TOC | 15.8 MB | fast (-fflags +fastseek) | -4.91 s | -4.90 s | 213 KB | 2 |
| M4A AAC, index first (faststart) | 19.4 MB | default (current) | +0.00 s | +0.00 s | 412 KB | 2 |
| M4A AAC, index first (faststart) | 19.4 MB | fast (-fflags +fastseek) | +0.00 s | +0.00 s | 412 KB | 2 |
| M4A AAC, index last | 19.4 MB | default (current) | +0.00 s | +0.00 s | 396 KB | 4 |
| M4A AAC, index last | 19.4 MB | fast (-fflags +fastseek) | +0.00 s | +0.00 s | 396 KB | 4 |

## Findings

1. **Today's extraction is accurate for every format, but MP3 costs grow with the playhead.** ffmpeg's MP3 demuxer seeks by *reading from the start of the file*, so every window downloads the episode up to its start: 14.6 MB for a window 15 minutes into this 128 kbps file. A window at 1:50 into a two-hour episode means reading about 100 MB, repeated for every window after it, and paid for in function time and the podcast host's bandwidth. The README's claim that "only those bytes are downloaded" held only for M4A.
2. **Fast seeking** (`-fflags +fastseek`) jumps straight to the window (about 200–360 KB read). It is exact for CBR MP3 (±0.03 s, one frame), including behind a cover-art ID3 tag. **For VBR MP3 it is off by seconds:** about 2 s late in the file even with a Xing TOC (the TOC has only 100 entries), and about 5 s without one. For ad skipping, 2–5 s means skipping into the show or leaving part of the ad.
3. **M4A/AAC** is exact and cheap in both modes, whether the index is at the start or the end.
4. **The ffmpeg version doesn't matter here.** The 2018 build and 7.0.2 behave the same (relevant to Q8).

Not measured: whether the browser's own seeking in VBR MP3 (when a listener jumps) lands where ffmpeg's accurate decode says. Normal playback from the start decodes sequentially, which is the reference used here.

## Decision

**C, the hybrid**, is implemented (`src/lib/server/audioFormat.ts`, used by `extractWindow`). Every window after the first reads the file's first bytes once per URL: 64 KB, more if a large ID3 tag comes first. Constant-bitrate MP3 (a LAME `Info` tag, or no Xing/VBRI tag and at least 10 frames with one bitrate) and MP4/M4A get `-fflags +fastseek`; everything else, and any failed probe, keeps the exact read. `src/lib/server/audio.test.ts` checks, through the real pipeline, that a CBR file is range-seeked and a VBR one isn't, and that a beep lands within 0.1 s in both.

## Options considered (Q14 in PRODUCTION_PLAN.md)

- **A. Keep as is.** Exact, but MP3 bandwidth and latency grow with the playhead.
- **B. Always fast-seek.** Cheap, but VBR MP3 ads are 2–5 s off.
- **C. Hybrid (recommended).** Read the first few KB (ID3 size plus the first frame header). Fast-seek when the file is CBR MP3 (a LAME `Info` tag, or no Xing/VBRI tag with a constant frame bitrate over the first frames) or MP4/M4A. Otherwise keep the exact read. The cost is one small extra range request per window (cacheable per URL). Most podcast feeds serve CBR MP3.
