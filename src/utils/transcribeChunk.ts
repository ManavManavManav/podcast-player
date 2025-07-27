import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export async function transcribeChunk(filePath: string): Promise<string> {
  const dir = path.dirname(filePath);
  const baseName = path.parse(filePath).name;
  const outPath = path.join(dir, `${baseName}.txt`);

  return new Promise((resolve, reject) => {
    const whisper = spawn("whisper", [
      filePath,
      "--model", "base",
      "--language", "en",
      "--output_format", "txt",
      "--output_dir", dir,
    ], {
      env: {
        ...process.env,
        PYTHONWARNINGS: "ignore", // optional: suppresses torch & FP16 warnings
      }
    });

    whisper.stdout.on("data", (data) => {
      console.log("Whisper stdout:", data.toString());
    });

    whisper.stderr?.on("data", (data) => {
      //console.error("Whisper stderr:", data.toString());
    });

    whisper.on("error", (err) => {
      console.error("Whisper spawn error:", err);
      reject(err);
    });

    whisper.on("close", async (code) => {
      console.log("Whisper exited with code:", code);

      if (code !== 0) {
        return reject(new Error(`Whisper exited with code ${code}`));
      }

      try {
        const content = await fs.readFile(outPath, "utf-8");
        console.log("✅ Transcript read:", outPath);
        console.log("📄 Transcript content preview:", content.slice(0, 300));
        resolve(content.trim());
      } catch (err) {
        console.error("❌ Failed to read transcript:", outPath, err);
        reject(err);
      }
    });
  });
}
