/* eslint-disable  @typescript-eslint/no-explicit-unknown */
// src/app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { podcastIndexSearch } from '@/lib/podcastIndexClient';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  const max = parseInt(req.nextUrl.searchParams.get('max') || '20');

  try {
    const data = await podcastIndexSearch(q, max);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
