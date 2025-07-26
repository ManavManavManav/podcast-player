// app/page.tsx
'use client';

import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchResults = async () => {
      if (!query) return;
      setLoading(true);
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.shows?.items || []);
      setLoading(false);
    };

    fetchResults();
  }, [query]);

  if (!query) {
    return (
      <div className="grid place-items-center min-h-[70vh]">
        <Image
          className="dark:invert"
          src="/podplay.svg"
          alt="podplay"
          width={180}
          height={38}
          priority
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto mt-8 px-4">
      <h1 className="text-2xl font-semibold mb-4">Search Results for: <span className="italic">{query}</span></h1>
      {loading ? (
        <p>Loading...</p>
      ) : results.length === 0 ? (
        <p>No results found.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {results.map((show) => (
            <Link key={show.id} href={`/show/${show.id}`}>
              <li className="flex gap-4 items-start border p-4 rounded-md hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer">
                <img src={show.images?.[0]?.url} alt={show.name} className="w-16 h-16 rounded object-cover" />
                <div>
                  <h3 className="font-medium">{show.name}</h3>
                  <p className="text-xs text-gray-600">{show.publisher}</p>
                </div>
              </li>
            </Link>
          ))}
        </ul>
      )}
    </div>
  );
}
