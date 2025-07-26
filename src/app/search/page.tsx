// app/search/page.tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export default function SearchPage() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q');

  useEffect(() => {
    // You’ll replace this with an API call
    console.log('Search for:', query);
  }, [query]);

  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold mb-4">Search Results</h1>
      {query ? (
        <p className="text-lg">You searched for: <strong>{query}</strong></p>
      ) : (
        <p className="text-lg">No search term provided.</p>
      )}
    </div>
  );
}
