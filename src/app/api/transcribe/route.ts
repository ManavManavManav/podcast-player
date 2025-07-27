// app/api/transcribe/route.ts
import { downloadFile } from '@/utils/downloadFile';
import { chunkAudio } from '@/utils/chunkAudio';
import { transcribeChunk } from '@/utils/transcribeChunk';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: Request) {
  try {
    const { url, start } = await req.json();

    if (!url || typeof start !== 'number') {
      return new Response(JSON.stringify({ error: 'Missing url or start' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tempDir = path.join(os.tmpdir(), 'chunks');
    await fs.mkdir(tempDir, { recursive: true });

    const audioPath = path.join(tempDir, `${uuidv4()}.mp3`);
    await downloadFile(url, audioPath);

    const chunkPath = path.join(tempDir, `${uuidv4()}_chunk.mp3`);
    await chunkAudio(audioPath, start, chunkPath);

    const transcript = await transcribeChunk(chunkPath);

    return new Response(JSON.stringify({ transcript }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error("❌ API error:", err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
