import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegPath } from "@/lib/server/audio";
import { canFastSeek, headBytesNeeded } from "@/lib/server/audioFormat";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podblock-format-"));
const files: Record<string, Buffer> = {};

beforeAll(() => {
  const source = path.join(dir, "source.wav");
  // Loud and quiet stretches, so VBR frame sizes actually vary.
  execFileSync(ffmpegPath, [
    "-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=20:c=pink:a=0.3",
    "-af", "volume='if(lt(mod(t,4),2),1,0.02)':eval=frame", source,
  ]);
  const cover = path.join(dir, "cover.png");
  execFileSync(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", "nullsrc=s=256x256,geq=random(1)*255:128:128", "-frames:v", "1", cover]);
  const encode = (name: string, args: string[], extraInputs: string[] = []) => {
    const out = path.join(dir, name);
    execFileSync(ffmpegPath, ["-v", "error", "-i", source, ...extraInputs, ...args, out]);
    files[name] = fs.readFileSync(out);
  };
  encode("cbr.mp3", ["-c:a", "libmp3lame", "-b:a", "64k"]);
  encode("cbr-no-tag.mp3", ["-c:a", "libmp3lame", "-b:a", "64k", "-write_xing", "0"]);
  encode("cbr-cover.mp3", ["-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic", "-id3v2_version", "3", "-c:a", "libmp3lame", "-b:a", "64k"], ["-i", cover]);
  encode("vbr.mp3", ["-c:a", "libmp3lame", "-q:a", "2"]);
  encode("vbr-no-toc.mp3", ["-c:a", "libmp3lame", "-q:a", "2", "-write_xing", "0"]);
  encode("aac.m4a", ["-c:a", "aac", "-b:a", "96k"]);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** What the analyzer would have read: enough of the start of the file. */
function head(name: string) {
  const file = files[name];
  const needed = headBytesNeeded(file.subarray(0, 16));
  return file.subarray(0, needed);
}

describe("canFastSeek", () => {
  it.each(["cbr.mp3", "cbr-no-tag.mp3", "cbr-cover.mp3", "aac.m4a"])("fast-seeks %s", (name) => {
    expect(canFastSeek(head(name))).toBe(true);
  });

  it.each(["vbr.mp3", "vbr-no-toc.mp3"])("reads %s exactly (variable bitrate)", (name) => {
    expect(canFastSeek(head(name))).toBe(false);
  });

  it("reads anything it doesn't recognize exactly", () => {
    expect(canFastSeek(Buffer.from("<html>not audio</html>"))).toBe(false);
    expect(canFastSeek(Buffer.alloc(0))).toBe(false);
    expect(canFastSeek(Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x10"))).toBe(false); // tag, then nothing
  });

  it("asks for more of the file when a tag (e.g. cover art) comes first", () => {
    const file = files["cbr-cover.mp3"];
    const tagSize = 10 + ((file[6] << 21) | (file[7] << 14) | (file[8] << 7) | file[9]);
    expect(tagSize).toBeGreaterThan(50_000);
    expect(headBytesNeeded(file.subarray(0, 16))).toBeGreaterThan(tagSize);
  });
});
