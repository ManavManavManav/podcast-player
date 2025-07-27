import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export async function transcribeChunk(filePath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const whisper = spawn("whisper", [filePath, "--model", "base", "--output_format", "txt"]);

    if (signal) {
      signal.addEventListener("abort", () => {
        whisper.kill("SIGTERM");
        reject(new Error("Aborted Whisper process"));
      });
    }

    whisper.on("close", (code) => {
      if (code === 0) {
        // Load and return transcript
        // (implement logic to read transcript from file)
        resolve("...transcript text...");
      } else {
        reject(new Error(`Whisper failed with code ${code}`));
      }
    });

    whisper.stderr.on("data", (data) => {
      console.error("Whisper stderr:", data.toString());
    });
  });
}
