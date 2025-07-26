// src/app/api/transcribe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function bufferFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const tempPath = path.join(os.tmpdir(), `${uuidv4()}.mp3`);
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
}

async function runWhisper(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = spawn('whisper', [filePath, '--language', 'en', '--model', 'base', '--output_format', 'json']);

    python.on('close', (code) => {
      if (code === 0) {
        const outputPath = filePath.replace(/\.[^/.]+$/, '.json');
        const result = fs.readFileSync(outputPath, 'utf8');
        resolve(result);
      } else {
        reject(`Whisper process exited with code ${code}`);
      }
    });
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('audio') as File;

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }

  try {
    const filePath = await bufferFile(file);
    const transcriptJSON = await runWhisper(filePath);
    return NextResponse.json(JSON.parse(transcriptJSON));
  } catch (err) {
    return NextResponse.json({ error: err }, { status: 500 });
  }
}
