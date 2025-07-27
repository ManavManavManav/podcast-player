// app/api/transcribe/route.ts

import { downloadFile } from "@/utils/downloadFile";
import { chunkAudio } from "@/utils/chunkAudio";
import { transcribeChunk } from "@/utils/transcribeChunk";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { NextRequest, NextResponse } from "next/server";
export async function POST(req: NextRequest) {
  const tempDir = path.join(os.tmpdir(), "chunks");
  await fs.mkdir(tempDir, { recursive: true });

  const audioPath = path.join(tempDir, `${uuidv4()}.mp3`);
  const chunkPath = path.join(tempDir, `${uuidv4()}_chunk.mp3`);

  try {
    const body = await req.json();
    const { url, start } = body;

    if (!url || typeof start !== "number") {
      return NextResponse.json(
        { error: "Missing url or start" },
        { status: 400 }
      );
    }

    const signal = req.signal;

    await downloadFile(url, audioPath);
    await chunkAudio(audioPath, chunkPath, start, 30, signal);
    const transcript = await transcribeChunk(chunkPath, signal);

    return NextResponse.json({ transcript });
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.log("🛑 Aborted transcription");
    } else {
      console.error("❌ Transcription error:", err);
    }
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  } finally {
    // Clean up temp files even on error or abort
    fs.unlink(audioPath).catch(() => {});
    fs.unlink(chunkPath).catch(() => {});
  }
}
