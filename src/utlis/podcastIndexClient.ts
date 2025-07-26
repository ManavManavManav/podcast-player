// utils/podcastIndexClient.ts
export async function podcastIndexFetch(endpoint: string, params: Record<string, string>) {
  const url = new URL(`https://api.podcastindex.org/api/1.0/${endpoint}`);

  Object.entries(params).forEach(([key, val]) => url.searchParams.append(key, val));

  const now = Math.floor(Date.now() / 1000).toString();
  const dataToSign = now + url.toString();
  const crypto = await import('crypto');
  const hash = crypto.createHmac('sha1', process.env.PODCAST_INDEX_API_SECRET!)
    .update(dataToSign)
    .digest('hex');

  const headers = {
    'X-Auth-Date': now,
    'X-Auth-Key': process.env.PODCAST_INDEX_API_KEY!,
    'Authorization': hash,
    'User-Agent': 'MyPodcastApp/1.0',
  };

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`PodcastIndex error: ${error}`);
  }

  return res.json();
}
