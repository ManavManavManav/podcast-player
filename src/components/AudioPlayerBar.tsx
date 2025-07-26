"use client";

import { useEffect, useRef, useState } from "react";
import { useAudioStore } from "@/store/audioStore";

export default function AudioPlayerBar() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentEpisode = useAudioStore((s) => s.currentEpisode);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (!currentEpisode || !audioRef.current) return;

    const audio = audioRef.current;
    audio.src = currentEpisode.enclosureUrl;
    audio.play();
    audio.volume = volume;
  }, [currentEpisode]);

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
    }
  };

  const skipBack = () => {
    if (audioRef.current) audioRef.current.currentTime -= 30;
  };

  const skipForward = () => {
    if (audioRef.current) audioRef.current.currentTime += 15;
  };

  const togglePause = () => {
    if (audioRef.current?.paused) {
      audioRef.current.play();
    } else {
      audioRef.current?.pause();
    }
  };

  if (!currentEpisode) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-black border-b border-gray-200 dark:border-gray-800 shadow">
      <div className="max-w-3xl mx-auto flex flex-col gap-2 px-4 py-3">
        <div className="flex justify-between items-center">
          <p className="text-sm font-medium truncate">{currentEpisode.title}</p>
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
          <button onClick={togglePause} className="text-sm">
            {audioRef.current?.paused ? "▶ Play" : "❚❚ Pause"}
          </button>
          <button onClick={skipForward} className="text-sm">+15s ⏩</button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-24"
          />
        </div>
        <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} hidden />
      </div>
    </div>
  );
}
