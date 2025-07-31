"use client";

import { useEffect, useRef, useState } from "react";
import { useAudioStore } from "@/store/audioStore";
import { useTranscriptionStore } from "@/store/transcriptionStore";
import {
  fetchTranscriptChunk,
  cancelTranscriptFetch,
} from "@/lib/fetchTranscript";

const CHUNK_SIZE = 30;
const PREFETCH_MARGIN = 20;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function AudioPlayerBar() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentEpisode = useAudioStore((s) => s.currentEpisode);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [sleepInput, setSleepInput] = useState("60");
  const [sleepTimer, setSleepTimer] = useState<NodeJS.Timeout | null>(null);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const [loadingChunk, setLoadingChunk] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

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

  useEffect(() => {
    if (!currentEpisode || !audioRef.current) return;

    setProgress(0);
    setCurrentTime(0);
    setDuration(0);

    const audio = audioRef.current;
    audio.src = currentEpisode.enclosureUrl;
    audio.load();
    audio.volume = volume;
    audio.play();
    setIsPlaying(true);
  }, [currentEpisode]);

  useEffect(() => {
    return () => {
      if (sleepTimer) {
        clearTimeout(sleepTimer);
        setSleepTimerActive(false);
      }
    };
  }, []);

  useEffect(() => {
    let raf: number;

    const updateProgress = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused && !audio.ended && !isNaN(audio.duration)) {
        const prog = audio.currentTime / audio.duration;
        setCurrentTime(audio.currentTime);
        setProgress(prog);
        raf = requestAnimationFrame(updateProgress);
      }
    };

    if (isPlaying) {
      raf = requestAnimationFrame(updateProgress);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isPlaying]);

  const handleTimeUpdate = async () => {
    const audio = audioRef.current;
    if (!audio || !visible) return;

    const currentTime = audio.currentTime;
    const currentChunkStart = Math.floor(currentTime / CHUNK_SIZE) * CHUNK_SIZE;
    const nextChunkStart = currentChunkStart + CHUNK_SIZE;
    const prefetchTriggerTime = nextChunkStart - PREFETCH_MARGIN;

    // --- Load current chunk if not seen ---
    if (
      !seenChunks.current.has(currentChunkStart) &&
      currentTime >= currentChunkStart
    ) {
      if (!loadingChunk) {
        seenChunks.current.add(currentChunkStart);
        setLoadingChunk(true);
        setLoading(true);
        latestChunkRequested.current = currentChunkStart;

        cancelTranscriptFetch();

        try {
          const text = await fetchTranscriptChunk(
            currentEpisode!.enclosureUrl,
            currentChunkStart
          );
          if (latestChunkRequested.current === currentChunkStart) {
            setChunk(currentChunkStart, text);
            if (audio.paused) {
              audio.play();
              setIsPlaying(true);
            }
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

    // --- Prefetch next chunk if near the end of current chunk ---
    if (
      !seenChunks.current.has(nextChunkStart) &&
      currentTime >= prefetchTriggerTime &&
      !loadingChunk
    ) {
      seenChunks.current.add(nextChunkStart);
      latestChunkRequested.current = nextChunkStart;

      try {
        const text = await fetchTranscriptChunk(
          currentEpisode!.enclosureUrl,
          nextChunkStart
        );
        if (latestChunkRequested.current === nextChunkStart) {
          setChunk(nextChunkStart, text);
        }
      } catch (err) {
        console.error("Transcript prefetch error:", err);
      }
    }

    const chunks = Array.from(chunkMap.entries()).sort(([a], [b]) => a - b);
    // === Keywords setup ===
    const keywordList = [
      ".com",
      "sponsored",
      "brought to you by",
      "advertisement",
      "promo code",
      "our partners",
    ];

    let displayedHTML = "";
    let currentChunkText = "";

    chunks.forEach(([start, val]) => {
      const end = start + CHUNK_SIZE;
      if (currentTime >= start && currentTime < end) {
        currentChunkText = val;
        displayedHTML = val
          .split("\n")
          .map((line) =>
            line.trim().length === 0
              ? ""
              : `<span style="background-color: yellow;">${line}</span>`
          )
          .join("\n");
      }
    });

    setText(displayedHTML);

    // === Keyword skipping ===
    if (
      currentChunkText &&
      keywordList.some((kw) =>
        currentChunkText.toLowerCase().includes(kw.toLowerCase())
      )
    ) {
      const newTime = Math.min(audio.currentTime + 15, audio.duration);
      audio.currentTime = newTime;
    }

    if (!isNaN(audio.duration) && audio.duration > 0) {
      const prog = audio.currentTime / audio.duration;
      setProgress(prog);
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration);
      useAudioStore.getState().setProgress(prog);
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (audio && audio.duration) {
      const newProgress = parseFloat(e.target.value);
      const newTime = newProgress * audio.duration;
      audio.currentTime = newTime;
      setCurrentTime(newTime);
      setProgress(newProgress);
      seenChunks.current.clear();
      cancelTranscriptFetch();
    }
  };

  const toggleTranscript = async () => {
    toggleVisible();
    clear();
    seenChunks.current.clear();
    cancelTranscriptFetch();

    const audio = audioRef.current;
    if (!audio) return;

    const time = audio.currentTime;
    const chunkStart = Math.floor(time / CHUNK_SIZE) * CHUNK_SIZE;

    if (!seenChunks.current.has(chunkStart)) {
      setLoading(true);
      setLoadingChunk(true);
      seenChunks.current.add(chunkStart);
      latestChunkRequested.current = chunkStart;

      try {
        const text = await fetchTranscriptChunk(
          currentEpisode!.enclosureUrl,
          chunkStart
        );
        if (latestChunkRequested.current === chunkStart) {
          setChunk(chunkStart, text);
          handleTimeUpdate(); // let it update `setText` properly
        }
      } catch (err) {
        console.error("Transcript error:", err);
      } finally {
        setLoading(false);
        setLoadingChunk(false);
      }
    }
  };

  const skipBack = () => {
    if (audioRef.current) audioRef.current.currentTime -= 30;
  };

  const skipForward = () => {
    if (audioRef.current) audioRef.current.currentTime += 30;
  };

  const togglePause = () => {
    const audio = audioRef.current;
    if (!audio || loadingChunk) return;

    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const stopPlayer = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    useAudioStore.getState().setCurrentEpisode(null);
    cancelTranscriptFetch();
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
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-sm border-t border-gray-300 dark:border-gray-700 shadow-lg">
      <div className="max-w-5xl mx-auto px-5 py-3 grid gap-4 items-center">
        {visible && (
          <div
            className="col-span-4 sm:col-span-4 w-full text-xs overflow-x-auto rounded max-h-48 p-2 border bg-gray-50 dark:bg-zinc-800"
            style={{ height: "150px" }}
          >
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
            value={isNaN(progress) ? 0 : progress}
            onChange={handleScrub}
            step="0.01"
            min="0"
            max="1"
            className="w-full accent-blue-500"
          />
          <div className="text-right text-xs text-gray-500 dark:text-gray-400">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="flex flex-col sm:flex-row sm:justify-between items-center gap-3 sm:gap-2 w-full">
            <div className="flex flex-row gap-2 mb-2 sm:mb-0">
              <button onClick={skipBack}>⏪</button>
              <button onClick={togglePause}>{isPlaying ? "⏸️" : "▶️"}</button>
              <button onClick={skipForward}>⏩</button>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="volume"
                className="text-xs text-gray-600 dark:text-gray-300"
              >
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
              <input
                type="number"
                value={sleepInput}
                onChange={(e) => setSleepInput(e.target.value)}
                className="w-16 px-1 py-0.5 text-xs rounded border border-gray-400 dark:border-gray-600 bg-white dark:bg-zinc-800"
              />
              <button onClick={toggleSleepTimer}>
                {sleepTimerActive ? "🟣" : "⚪"}
              </button>
            </div>
          </div>
        </div>

        <audio
          ref={audioRef}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration);
              setCurrentTime(audioRef.current.currentTime);
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          hidden
        />
      </div>
    </div>
  );
}
