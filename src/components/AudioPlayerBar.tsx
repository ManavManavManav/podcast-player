"use client";

import { useEffect, useRef, useState } from "react";
import { useAudioStore } from "@/store/audioStore";

export default function AudioPlayerBar() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentEpisode = useAudioStore((s) => s.currentEpisode);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [sleepInput, setSleepInput] = useState("60");
  const [sleepTimer, setSleepTimer] = useState<NodeJS.Timeout | null>(null);

  const [sleepTimerActive, setSleepTimerActive] = useState(false);

  useEffect(() => {
    if (!currentEpisode || !audioRef.current) return;

    const audio = audioRef.current;
    audio.src = currentEpisode.enclosureUrl;
    audio.play();
    audio.volume = volume;
  }, [currentEpisode]);

  useEffect(() => {
    return () => {
      if (sleepTimer) {
        clearTimeout(sleepTimer);
        setSleepTimerActive(false);
      }
    };
  }, []);

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio && audio.duration > 0) {
      const newProgress = audio.currentTime / audio.duration;
      setProgress(newProgress);
      useAudioStore.getState().setProgress(newProgress);
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
    if (audioRef.current) audioRef.current.currentTime += 30;
  };

  const togglePause = () => {
    if (audioRef.current?.paused) {
      audioRef.current.play();
    } else {
      audioRef.current?.pause();
    }
  };

  const stopPlayer = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    useAudioStore.getState().setCurrentEpisode(null);
  };

  const toggleSleepTimer = () => {
    if (sleepTimerActive && sleepTimer) {
      clearTimeout(sleepTimer);
      setSleepTimer(null);
      setSleepTimerActive(false);
    } else {
      const value = parseInt(sleepInput, 10);
      if (!isNaN(value) && value > 0) {
        const timer = setTimeout(() => {
          audioRef.current?.pause();
          setSleepTimer(null);
          setSleepTimerActive(false);
        }, value * 1000);
        setSleepTimer(timer);
        setSleepTimerActive(true);
      }
    }
  };

  if (!currentEpisode) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-zinc-900 border-t border-gray-300 dark:border-gray-700 shadow-lg">
      <div className="max-w-5xl mx-auto px-4 py-3 grid grid-cols-5 gap-4 items-center">
        {/* Transcript Box (Dummy) */}
        <div className="col-span-1 hidden sm:block text-xs text-left overflow-y-auto max-h-32 border-r pr-4">
          <p className="text-gray-500 dark:text-gray-400">
            Transcript will appear here...
          </p>
        </div>

        {/* Controls */}
        <div className="col-span-4 sm:col-span-4 flex flex-col gap-2 w-full">
          <div className="flex justify-between items-center text-sm font-medium">
            <p className="truncate">{currentEpisode.title}</p>
            <button
              onClick={stopPlayer}
              className="text-red-500 hover:text-red-700"
            >
              <svg className="w-2 h-2" viewBox="0 0 48 48">
                <circle
                  cx="24"
                  cy="24"
                  r="22"
                  fill="#E53935"
                  stroke="#B71C1C"
                  strokeWidth="4"
                />
              </svg>
            </button>
          </div>

          {/* Scrub bar */}
          <input
            type="range"
            value={progress}
            onChange={handleScrub}
            step="0.01"
            min="0"
            max="1"
            className="w-full accent-blue-500"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button onClick={skipBack}>
                <svg className="w-5 h-5" viewBox="0 0 48 48">
                  <circle
                    cx="24"
                    cy="24"
                    r="22"
                    fill="#FF9800"
                    stroke="#EF6C00"
                    strokeWidth="4"
                  />
                  <polygon points="30,16 22,24 30,32" fill="white" />
                  <polygon points="22,16 14,24 22,32" fill="white" />
                </svg>
              </button>
              <button onClick={togglePause}>
                {audioRef.current?.paused ? (
                  // ▶️ Play
                  <svg className="w-6 h-6" viewBox="0 0 48 48">
                    <circle
                      cx="24"
                      cy="24"
                      r="22"
                      fill="#4CAF50"
                      stroke="#388E3C"
                      strokeWidth="4"
                    />
                    <polygon points="20,16 34,24 20,32" fill="white" />
                  </svg>
                ) : (
                  // ⏸️ Pause
                  <svg className="w-6 h-6" viewBox="0 0 48 48">
                    <circle
                      cx="24"
                      cy="24"
                      r="22"
                      fill="#F44336"
                      stroke="#C62828"
                      strokeWidth="4"
                    />
                    <rect x="17" y="16" width="5" height="16" fill="white" />
                    <rect x="26" y="16" width="5" height="16" fill="white" />
                  </svg>
                )}
              </button>
              <button onClick={skipForward}>
                <svg className="w-5 h-5" viewBox="0 0 48 48">
                  <circle
                    cx="24"
                    cy="24"
                    r="22"
                    fill="#2196F3"
                    stroke="#1976D2"
                    strokeWidth="4"
                  />
                  <polygon points="18,16 26,24 18,32" fill="white" />
                  <polygon points="26,16 34,24 26,32" fill="white" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="volume"
                className="text-xs text-gray-600 dark:text-gray-300"
              >
                Volume
              </label>
              <input
                id="volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-24"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              <label htmlFor="sleep" className="whitespace-nowrap">
                Sleep(s)
              </label>
              <input
                id="sleep"
                type="number"
                value={sleepInput}
                onChange={(e) => setSleepInput(e.target.value)}
                className="w-16 px-1 py-0.5 text-xs rounded border border-gray-400 dark:border-gray-600 bg-white dark:bg-zinc-800"
              />
              <button onClick={toggleSleepTimer}>
                {sleepTimerActive ? (
                  // 🟣 Active Bubble
                  <svg className="w-5 h-5" viewBox="0 0 48 48" fill="none">
                    <circle
                      cx="24"
                      cy="24"
                      r="22"
                      fill="purple"
                      transform="rotate(-90 24 24)"
                    />
                    <path
                      d="M24 14V24L30 28"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  // ⚪ Inactive Gray Bubble
                  <svg className="w-5 h-5" viewBox="0 0 48 48" fill="none">
                    <circle
                      cx="24"
                      cy="24"
                      r="22"
                      fill="#BDBDBD"
                      transform="rotate(-90 24 24)"
                    />
                    <path
                      d="M24 14V24L30 28"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} hidden />
      </div>
    </div>
  );
}
