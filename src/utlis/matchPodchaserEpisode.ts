async function getPodchaserToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.PODCHASER_CLIENT_ID!,
    client_secret: process.env.PODCHASER_CLIENT_SECRET!,
  });

  const res = await fetch('https://api.podchaser.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Podchaser token fetch failed: ${error}`);
  }

  const data = await res.json();
  return data.access_token;
}

export async function findEquivalentPodchaserEpisode(spotifyEp: any) {
  const query = `
    query SearchEpisodes($term: String!) {
      search(term: $term, types: [EPISODE]) {
        episodes {
          data {
            id
            title
            audioUrl
            description
            podcast {
              title
            }
          }
        }
      }
    }
  `;

  const variables = {
    term: `${spotifyEp.name} ${spotifyEp.show?.name || ''}`,
  };

  const token = await getPodchaserToken();

  const res = await fetch('https://api.podchaser.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('Podchaser GraphQL Error:', error);
    return null;
  }

  const json = await res.json();
  const match = json?.data?.search?.episodes?.data?.[0];

  return match || null;
}
