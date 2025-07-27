"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { podcastIndexFetch } from "@/lib/podcastIndexClient";
import { useAudioStore } from "@/store/audioStore";

export default function ShowPage() {
  const { id } = useParams();
  const [showData, setShowData] = useState<any>(null);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const setCurrentEpisode = useAudioStore((state) => state.setCurrentEpisode);
  const currentEpisode = useAudioStore((state) => state.currentEpisode);
  const progress = useAudioStore((state) => state.progress);

  useEffect(() => {
    const fetchShow = async () => {
      try {
        const showRes = await podcastIndexFetch("podcasts/byfeedid", {
          id: id as string,
        });
        const episodesRes = await podcastIndexFetch("episodes/byfeedid", {
          id: id as string,
          max: "20",
        });

        setShowData(showRes.feed);
        setEpisodes(episodesRes.items);
      } catch (err) {
        console.error("Error loading podcast:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchShow();
  }, [id]);

  const ringRadius = 18;
  const stroke = 2;
  const normalizedRadius = ringRadius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;

  if (loading) return <p className="p-8">Loading show...</p>;
  if (!showData) return <p className="p-8">Show not found.</p>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-40">
      <div className="flex items-start gap-6 mb-8">
        <img
          src={showData.image}
          alt={showData.title}
          className="w-32 h-32 rounded object-cover"
        />
        <div>
          <h1 className="text-2xl font-bold">{showData.title}</h1>
          <p className="text-sm text-gray-600">{showData.author}</p>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 line-clamp-4">
            {showData.description}
          </p>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-4">Recent Episodes</h2>
      <ul className="space-y-4">
        {episodes.map((ep) => {
          const isCurrent = currentEpisode?.id === ep.id;
          const percent = isCurrent ? progress : 0;
          const offset = circumference - percent * circumference;

          return (
            <li
              key={ep.id}
              onClick={() => setCurrentEpisode(ep)}
              className={`relative group cursor-pointer border rounded-md p-4 flex items-center justify-between gap-4 transition-colors duration-200 ${
                isCurrent
                  ? "ring-2 ring-green-500 dark:ring-green-400 bg-blue-50/50 dark:bg-zinc-800/50 backdrop-blur-sm"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
              }`}
            >
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm text-black dark:text-white group-hover:text-blue-600 transition-colors">
                  {ep.title}
                </h3>
                <p className="text-xs text-gray-500">
                  {Math.floor(ep.duration / 60)} min
                </p>
              </div>

              <div className="relative w-10 h-10 shrink-0">
                <svg
                  height="100%"
                  width="100%"
                  viewBox="0 0 36 36"
                  className="absolute top-0 left-0"
                >
                </svg>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
