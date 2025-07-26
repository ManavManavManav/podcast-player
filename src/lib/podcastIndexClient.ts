'use server';


import crypto from 'crypto';

const apiKey = process.env.PODCAST_INDEX_API_KEY!;
const secretBase64 = process.env.PODCAST_INDEX_API_SECRET_BASE64!;
const apiSecret = Buffer.from(secretBase64, 'base64').toString('utf-8');
const userAgent = 'ManavPodcastApp/1.0 (https://github.com/yourgithub)';

function buildHeaders(): { headers: Record<string, string>; authDate: string } {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const hashInput = apiKey + apiSecret + authDate;
  const auth = crypto.createHash('sha1').update(hashInput).digest('hex');

  return {
    headers: {
      'User-Agent': userAgent,
      'X-Auth-Date': authDate,
      'X-Auth-Key': apiKey,
      Authorization: auth
    },
    authDate
  };
}

export async function podcastIndexSearch(term: string, max: number = 5) {
  const url = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(term)}&max=${max}`;
  const { headers } = buildHeaders();

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[PodcastIndex error] ${res.status}: ${err}`);
    throw new Error(`PodcastIndex error: ${res.status}`);
  }

  return res.json();
}

export async function podcastIndexFetch(
  endpoint: string,
  params: Record<string, string>
) {
  const query = new URLSearchParams(params).toString();
  const url = `https://api.podcastindex.org/api/1.0/${endpoint}?${query}`;
  const { headers } = buildHeaders();

  // console.debug('[DEBUG] Full URL:', url);
  // console.debug('[DEBUG] Headers:', headers);

  const res = await fetch(url, { headers });
  
  if (!res.ok) {
    const err = await res.text();
    console.error(`[PodcastIndex error] ${res.status}: ${err}`);
    throw new Error(`PodcastIndex error: ${res.status}`);
  }
  
  return res.json();
}
