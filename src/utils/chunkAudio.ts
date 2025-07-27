// utils/chunkAudio.ts
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const CHUNK_SIZE="300";
export async function chunkAudio(inputPath: string, outputPath: string, start: number, duration: number, signal?: AbortSignal): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-ss", String(start),
      "-t", String(duration),
      "-i", inputPath,
      "-acodec", "copy",
      outputPath
    ]);

    if (signal) {
      signal.addEventListener("abort", () => {
        ffmpeg.kill("SIGKILL");
        reject(new Error("Aborted ffmpeg process"));
      });
    }

    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed with code ${code}`));
    });

    ffmpeg.stderr.on("data", (data) => {
      console.error("FFmpeg stderr:", data.toString());
    });
  });
}
