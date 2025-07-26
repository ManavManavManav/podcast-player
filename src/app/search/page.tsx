"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function SearchPage() {
  const [results, setResults] = useState<any[]>([]);
  const searchParams = useSearchParams();
  const q = searchParams.get("q");

  useEffect(() => {
    if (!q) return;
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((res) => res.json())
      .then(setResults)
      .catch(console.error);
  }, [q]);

  return (
    <div className="px-4 sm:px-6 md:px-8 py-10 max-w-5xl mx-auto">
      <h1 className="text-2xl sm:text-3xl font-extrabold mb-8 text-center">
        Search Results for <span className="text-blue-600">"{q}"</span>
      </h1>

      {results.feeds?.length === 0 && (
        <p className="text-center text-gray-500">No results found.</p>
      )}

      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {results.feeds?.map((feed) => (
          <li
            key={feed.id}
            className="bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden"
          >
            <div className="flex items-center gap-4 p-4">
              {feed.image && (
                <img
                  src={feed.image}
                  alt={feed.title}
                  className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold leading-tight truncate">
                  {feed.title}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                  {feed.description?.replace(/<\/?[^>]+(>|$)/g, "").slice(0, 120)}...
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-black/5 dark:border-white/10 text-right">
              <Link href={`/show/${feed.id}`}>
                <div className="text-sm font-medium text-blue-600 hover:underline">
                  View episodes →
                </div>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
