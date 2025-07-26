// app/api/spotify/search/route.ts
import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");

  const h = await headers(); // ✅ properly await
  const baseUrl = h.get("host");
  const protocol = baseUrl?.includes("localhost") ? "http" : "https";

  const tokenRes = await fetch(`${protocol}://${baseUrl}/api/spotify/token`);
  const { access_token } = await tokenRes.json();

  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query || '')}&type=show&limit=50`,
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }
  );

  const data = await searchRes.json();
  return NextResponse.json(data);
}
