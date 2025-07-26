"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { findEquivalentPodchaserEpisode } from "@/utlis/matchPodchaserEpisode";
export default function ShowPage() {
  const { id } = useParams();
  const [showData, setShowData] = useState<any>(null);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [fullEpisode, setFullEpisode] = useState<any | null>(null);
  const handlePlayFullEpisode = async (ep: any) => {
    const match = await findEquivalentPodchaserEpisode(ep);
    if (match && match.audioUrl) {
      audioRef.current.src = match.audioUrl;
      audioRef.current.play();
      setPlayingId(ep.id);
      setFullEpisode(match);
    } else {
      alert("Full episode not available.");
    }
  };
  useEffect(() => {
    const fetchShow = async () => {
      const tokenRes = await fetch("/api/spotify/token");
      const { access_token } = await tokenRes.json();

      const showRes = await fetch(
        `https://api.spotify.com/v1/shows/${id}?market=US`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );
      const show = await showRes.json();

      const episodesRes = await fetch(
        `https://api.spotify.com/v1/shows/${id}/episodes?market=US&limit=10`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );
      const episodesData = await episodesRes.json();

      setShowData(show);
      setEpisodes(episodesData.items || []);
      setLoading(false);
    };

    fetchShow();
  }, [id]);

  const togglePlay = (episode: any) => {
    if (!episode.audio_preview_url) return;

    if (playingId === episode.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = episode.audio_preview_url;
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

  const ringRadius = 18;
  const stroke = 2;
  const normalizedRadius = ringRadius - stroke * 0.5;
  const circumference = normalizedRadius * 2 * Math.PI;

  if (loading) return <p className="p-8">Loading show...</p>;
  if (!showData) return <p className="p-8">Show not found.</p>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-start gap-6 mb-8">
        <img
          src={showData.images?.[0]?.url}
          alt={showData.name}
          className="w-32 h-32 rounded object-cover"
        />
        <div>
          <h1 className="text-2xl font-bold">{showData.name}</h1>
          <p className="text-sm text-gray-600">{showData.publisher}</p>
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
              {/* Text content on left */}
              <div className="flex-1 min-w-0">
                <h3
                  className="font-medium text-sm text-blue-600 cursor-pointer underline"
                  onClick={() => handlePlayFullEpisode(ep)}
                >
                  {ep.name}
                </h3>
                <p className="text-xs text-gray-500">
                  {Math.floor(ep.duration_ms / 60000)} min
                </p>
              </div>

              {/* Play button with fixed size and ring */}
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
                  {playingId === ep.id && (
                    <circle
                      stroke="#3b82f6"
                      fill="transparent"
                      strokeWidth="2"
                      strokeDasharray={2 * Math.PI * 16}
                      strokeDashoffset={(1 - progress) * 2 * Math.PI * 16}
                      strokeLinecap="round"
                      r="16"
                      cx="18"
                      cy="18"
                      style={{ transition: "stroke-dashoffset 0.25s linear" }}
                    />
                  )}
                </svg>

                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <span className="text-xs font-bold text-black dark:text-white">
                    {playingId === ep.id ? "❚❚" : "▶"}
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
    </div>
  );
}
