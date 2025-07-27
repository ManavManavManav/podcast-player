// utils/chunkAudio.ts
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const CHUNK_SIZE="300";

export async function chunkAudio(inputPath: string, start: number, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "error",
      "-ss", String(start),
      "-t", CHUNK_SIZE,
      "-i", inputPath,
      "-acodec", "copy",
      outputPath,
    ]);

    ffmpeg.stderr?.on("data", (data) => {
      //console.error("FFmpeg stderr:", data.toString());
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("FFmpeg failed with code " + code));
    });
  });
}
