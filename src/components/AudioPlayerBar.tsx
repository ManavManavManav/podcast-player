// PATCHED AudioPlayerBar.tsx to transcribe live in 30s chunks

"use client";

import { useEffect, useRef, useState } from "react";
import { useAudioStore } from "@/store/audioStore";
import { useTranscriptionStore } from "@/store/transcriptionStore";
import { fetchTranscriptChunk } from "@/lib/fetchTranscript";

const CHUNK_SIZE = 30;
const PREFETCH_MARGIN = 10;

export default function AudioPlayerBar() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentEpisode = useAudioStore((s) => s.currentEpisode);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [sleepInput, setSleepInput] = useState("60");
  const [sleepTimer, setSleepTimer] = useState<NodeJS.Timeout | null>(null);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const [loadingChunk, setLoadingChunk] = useState(false);

  const {
    visible,
    text,
    setText,
    setLoading,
    toggleVisible,
    clear,
    chunkMap,
    setChunk,
  } = useTranscriptionStore();

  const seenChunks = useRef<Set<number>>(new Set());
  const latestChunkRequested = useRef<number | null>(null);
  const abortController = useRef<AbortController | null>(null);

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

  const handleTimeUpdate = async () => {
    const audio = audioRef.current;
    if (!audio || !visible) return;

    const currentTime = audio.currentTime;
    const currentChunkStart = Math.floor(currentTime / CHUNK_SIZE) * CHUNK_SIZE;

    // Wait if chunk isn't ready yet
    if (!seenChunks.current.has(currentChunkStart)) {
      if (!loadingChunk) {
        seenChunks.current.add(currentChunkStart);
        setLoadingChunk(true);
        setLoading(true);
        latestChunkRequested.current = currentChunkStart;

        try {
          const text = await fetchTranscriptChunk(
            currentEpisode!.enclosureUrl,
            currentChunkStart
          );
          if (latestChunkRequested.current === currentChunkStart) {
            setChunk(currentChunkStart, text);
            setText(text);
            audio.play();
          }
        } catch (err) {
          console.error("Transcript error:", err);
        } finally {
          setLoading(false);
          setLoadingChunk(false);
        }
      } else {
        audio.pause();
      }
    }

    // Highlight current chunk
    const chunks = Array.from(chunkMap.entries()).sort(([a], [b]) => a - b);
    const html = chunks
      .map(([start, val]) => {
        const end = start + CHUNK_SIZE;
        if (currentTime >= start && currentTime < end) {
          return `<mark>${val}</mark>`;
        }
        return val;
      })
      .join("\n");
    setText(html);

    const newProgress = audio.currentTime / audio.duration;
    setProgress(newProgress);
    useAudioStore.getState().setProgress(newProgress);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (audio) {
      const newTime = parseFloat(e.target.value) * audio.duration;
      audio.currentTime = newTime;
      seenChunks.current.clear();

      if (abortController.current) {
        abortController.current.abort();
      }
    }
  };

  const toggleTranscript = () => {
    toggleVisible();
    clear();
    seenChunks.current.clear();
  };

  const skipBack = () => {
    if (audioRef.current) audioRef.current.currentTime -= 30;
  };

  const skipForward = () => {
    if (audioRef.current) audioRef.current.currentTime += 30;
  };

  const togglePause = () => {
    if (!loadingChunk) {
      if (audioRef.current?.paused) {
        audioRef.current.play();
      } else {
        audioRef.current?.pause();
      }
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
      <div className="max-w-5xl mx-auto px-5 py-3 grid gap-4 items-center">
        {visible && (
          <div className="col-span-1 sm:col-span-1 text-xs overflow-x-auto max-h-48 p-2 border bg-gray-50 dark:bg-zinc-800" style={{ height: '150px' }}>
            <div
              className="whitespace-pre-line text-gray-800 dark:text-gray-200"
              dangerouslySetInnerHTML={{ __html: text }}
            />
          </div>
        )}

        <div className="col-span-4 sm:col-span-4 flex flex-col gap-2 w-full">
          <div className="flex justify-between items-center text-sm font-medium">
            <p className="truncate">{currentEpisode.title}</p>
            <div className="flex gap-2 items-center">
              <button
                onClick={toggleTranscript}
                className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-zinc-700"
              >
                📜 Transcript
              </button>
              {loadingChunk && <span className="animate-spin">🔄</span>}
              <button onClick={stopPlayer}>❌</button>
            </div>
          </div>

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
              <button onClick={skipBack}>⏪</button>
              <button onClick={togglePause}>{audioRef.current?.paused ? "▶️" : "⏸️"}</button>
              <button onClick={skipForward}>⏩</button>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="volume" className="text-xs text-gray-600 dark:text-gray-300">
                🔉
              </label>
              <input
                id="volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setVolume(v);
                  if (audioRef.current) audioRef.current.volume = v;
                }}
                className="w-24"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
              ⏲️
              <input
                type="number"
                value={sleepInput}
                onChange={(e) => setSleepInput(e.target.value)}
                className="w-16 px-1 py-0.5 text-xs rounded border border-gray-400 dark:border-gray-600 bg-white dark:bg-zinc-800"
              />
              <button onClick={toggleSleepTimer}>{sleepTimerActive ? "🟣" : "⚪"}</button>
            </div>
          </div>
        </div>

        <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} hidden />
      </div>
    </div>
  );
}