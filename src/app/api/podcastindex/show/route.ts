// app/api/podcastindex/show/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { podcastIndexFetch } from '@/lib/podcastIndexClient';

export async function GET(req: NextRequest) {
  const feedId = req.nextUrl.searchParams.get('id');
  if (!feedId) {
    return NextResponse.json({ error: 'Missing feedId' }, { status: 400 });
  }

  try {
    const data = await podcastIndexFetch('episodes/byfeedid', {
      id: feedId,
      max: '20',
    });

    return NextResponse.json(data.items);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
