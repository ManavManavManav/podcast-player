"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { podcastIndexFetch } from "@/lib/podcastIndexClient";

export default function ShowPage() {
  const { id } = useParams();
  const [showData, setShowData] = useState<any>(null);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const togglePlay = (episode: any) => {
    if (!episode.enclosureUrl) return;

    if (playingId === episode.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = episode.enclosureUrl;
        audioRef.current.play();
        setPlayingId(episode.id);
        setProgress(0);
      }
    }
  };

  const handleEnded = () => {
    setPlayingId(null);
    setProgress(0);
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio && audio.duration > 0) {
      setProgress(audio.currentTime / audio.duration);
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (audio) {
      const newTime = parseFloat(e.target.value) * audio.duration;
      audio.currentTime = newTime;
      setProgress(newTime / audio.duration);
    }
  };

  const skipForward = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime += 15;
    }
  };

  const skipBack = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime -= 30;
    }
  };

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  };

  const ringRadius = 18;
  const stroke = 2;
  const normalizedRadius = ringRadius - stroke * 0.5;
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
          const isPlaying = playingId === ep.id;
          const offset = circumference - progress * circumference;

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
                onClick={() => togglePlay(ep)}
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
                  {isPlaying && (
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
                  )}
                </svg>

                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <span className="text-xs font-bold text-black dark:text-white">
                    {isPlaying ? "❚❚" : "▶"}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        hidden
      />

      {playingId && (
        <div className="fixed bottom-0 left-0 w-full bg-white dark:bg-black border-t border-gray-200 dark:border-gray-800 p-4 shadow z-50">
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <p className="text-sm font-medium truncate">
                {episodes.find((ep) => ep.id === playingId)?.title || "Playing..."}
              </p>
              <button
                onClick={() => {
                  audioRef.current?.pause();
                  setPlayingId(null);
                }}
                className="text-sm text-blue-600 hover:underline"
              >
                Stop
              </button>
            </div>
            <input
              type="range"
              value={progress}
              onChange={handleScrub}
              step="0.01"
              min="0"
              max="1"
              className="w-full"
            />
            <div className="flex justify-between items-center gap-4">
              <button onClick={skipBack} className="text-sm">⏪ 30s</button>
              <button
                onClick={() => {
                  if (audioRef.current?.paused) {
                    audioRef.current.play();
                  } else {
                    audioRef.current?.pause();
                  }
                }}
                className="text-sm"
              >
                {audioRef.current?.paused ? "▶ Play" : "❚❚ Pause"}
              </button>
              <button onClick={skipForward} className="text-sm">+15s ⏩</button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={changeVolume}
                className="w-24"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
