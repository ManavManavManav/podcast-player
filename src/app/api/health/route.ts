import { NextResponse } from "next/server";
import type { HealthResponse } from "@/lib/types";
import { detectConfig, transcribeConfig } from "@/lib/server/config";
import { hasPodcastIndexCredentials } from "@/lib/server/podcastIndex";
import { requireUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const podcastIndex = hasPodcastIndexCredentials();
  const transcription = Boolean(transcribeConfig());
  const detection = Boolean(detectConfig());
  const body: HealthResponse = { ok: podcastIndex && transcription && detection, podcastIndex, transcription, detection };
  return NextResponse.json(body);
}
