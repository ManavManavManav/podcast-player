import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q');
  if (!query) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  const res = await fetch(`https://api.podchaser.com/search?query=${encodeURIComponent(query)}&type=episode`, {
    headers: {
      'X-API-KEY': process.env.PODCHASER_API_KEY!, // Store this in .env.local
    },
  });

  const data = await res.json();
  return NextResponse.json(data);
}
