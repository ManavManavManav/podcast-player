// app/api/episodes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { podcastIndexFetch } from '@/lib/podcastIndexClient';

export async function GET(req: NextRequest) {
  const feedId = req.nextUrl.searchParams.get('id');
  if (!feedId) return NextResponse.json({ error: 'Missing feedId' }, { status: 400 });

  const data = await podcastIndexFetch('episodes/byfeedid', {
    id: feedId,
    max: '10',
  });

  return NextResponse.json(data.items); // episodes
}
