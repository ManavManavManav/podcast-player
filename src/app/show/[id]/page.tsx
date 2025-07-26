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
          const offset = circumference - 0 * circumference;

          return (
            <li
              key={ep.id}
              className="border rounded-md p-4 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm text-blue-600 cursor-pointer underline">
                  {ep.title}
                </h3>
                <p className="text-xs text-gray-500">
                  {Math.floor(ep.duration / 60)} min
                </p>
              </div>

              <button
                onClick={() => setCurrentEpisode(ep)}
                className="relative w-12 h-12 shrink-0"
              >
                <svg
                  height="100%"
                  width="100%"
                  viewBox="0 0 36 36"
                  className="absolute top-0 left-0"
                >
                  <circle
                    stroke="#e5e7eb"
                    fill="transparent"
                    strokeWidth="2"
                    r="16"
                    cx="18"
                    cy="18"
                  />
                  <circle
                    stroke="#3b82f6"
                    fill="transparent"
                    strokeWidth="2"
                    strokeDasharray={2 * Math.PI * 16}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    r="16"
                    cx="18"
                    cy="18"
                    style={{
                      transition: "stroke-dashoffset 0.25s linear",
                      transform: "rotate(-90deg)",
                      transformOrigin: "center",
                    }}
                  />
                </svg>

                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <span className="text-xs font-bold text-black dark:text-white">
                    ▶
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
