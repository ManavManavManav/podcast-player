// app/api/test-rss/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const rssUrl = req.nextUrl.searchParams.get('url');
  if (!rssUrl) return NextResponse.json({ error: 'Missing RSS URL' }, { status: 400 });

  try {
    const res = await fetch(rssUrl);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>(.*?)<\/item>/gs)];

    const episodes = items.slice(0, 5).map((item) => {
      const audioUrl = item[1].match(/<enclosure .*?url="(.*?)"/)?.[1] || '';
      const title = item[1].match(/<title>(.*?)<\/title>/)?.[1] || '';
      return { title, audioUrl };
    });

    return NextResponse.json({ episodes });
  } catch (err) {
    return NextResponse.json({ error: (err as any).message }, { status: 500 });
  }
}
