'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import Cookies from 'js-cookie';
import Image from 'next/image';
import { useUserStore } from '@/lib/store/useUserStore';

export default function TopBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeQuery = searchParams.get('q');

  const { username, logout } = useUserStore();
  const [query, setQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  // Load search history on first render
  useEffect(() => {
    const stored = Cookies.get('recentSearches');
    if (stored) setRecentSearches(JSON.parse(stored));
  }, []);

  const saveSearch = (term: string) => {
    const updated = [term, ...recentSearches.filter(q => q !== term)].slice(0, 4);
    Cookies.set('recentSearches', JSON.stringify(updated), { expires: 7 });
    setRecentSearches(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    saveSearch(trimmed);
    router.push(`/?q=${encodeURIComponent(trimmed)}`);
    setQuery('');
    setShowDropdown(false);
  };

  const handleSelectRecent = (term: string) => {
    saveSearch(term);
    router.push(`/?q=${encodeURIComponent(term)}`);
    setQuery('');
    setShowDropdown(false);
  };

  return (
    <div className="sticky top-0 z-50 w-full bg-white/80 dark:bg-black/60 backdrop-blur-md border-b border-black/10 dark:border-white/10 px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 relative">
      {/* Home Button */}
      <button onClick={() => router.push('/')} className="text-sm font-medium hover:underline">
        Home
      </button>

      {/* Search Input + History */}
      <div className="relative w-full max-w-xl">
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Search podcasts..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            className="w-full rounded-full border border-black/10 dark:border-white/20 px-4 py-2 bg-white dark:bg-black text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </form>

        {/* Show history suggestions if not already viewing search */}
        {showDropdown && !activeQuery && recentSearches.length > 0 && (
          <ul className="absolute mt-1 w-full bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/20 rounded-md shadow z-40">
            {recentSearches.map((term, index) => (
              <li
                key={index}
                onClick={() => handleSelectRecent(term)}
                className="px-4 py-2 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-neutral-800"
              >
                {term}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Profile + Logout */}
      <div className="flex items-center gap-3">
        <span className="text-sm hidden sm:inline">{username}</span>
        <button onClick={logout} className="text-sm font-medium hover:underline">
          Logout
        </button>
      </div>
    </div>
  );
}
