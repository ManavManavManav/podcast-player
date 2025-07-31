import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

export async function transcribeChunk(
  filePath: string,
  signal?: AbortSignal
): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `whisper_${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const whisper = spawn("whisper", [
      filePath,
      "--model", "tiny",
      "--output_format", "txt",
      "--output_dir", tempDir,
    ]);

    const abortHandler = () => {
      whisper.kill("SIGTERM");
      reject(new Error("Aborted Whisper process"));
    };

    if (signal?.aborted) {
      abortHandler();
      return;
    }

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    whisper.stderr.on("data", (data) => {
      console.error("Whisper stderr:", data.toString());
    });

    whisper.on("close", async (code) => {
      const elapsed = Date.now() - startTime;
      console.log(`Whisper exited with code ${code} in ${elapsed}ms`);

      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }

      if (code === 0) {
        try {
          const baseName = path.parse(filePath).name;
          const transcriptPath = path.join(tempDir, `${baseName}.txt`);
          const transcript = await fs.readFile(transcriptPath, "utf-8");

          // Optionally: clean up temp dir
          // await fs.rm(tempDir, { recursive: true, force: true });

          resolve(transcript.trim());
        } catch (err) {
          reject(new Error(`Failed to read transcript: ${(err as Error).message}`));
        }
      } else {
        reject(new Error(`Whisper failed with code ${code}`));
      }
    });
  });
}
