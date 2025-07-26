// components/AudioPlayer.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useAudioStore } from '@/lib/store/useAudioStore';
import Image from 'next/image';
import { Pause, Play, RotateCcw, RotateCw, Timer, AlignLeft } from 'lucide-react';

export default function AudioPlayer() {
  const { current, isPlaying, togglePlay, stop } = useAudioStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sleepTimeout, setSleepTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!current) return;
    if (!audioRef.current) return;

    isPlaying ? audioRef.current.play() : audioRef.current.pause();
  }, [isPlaying, current]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime);
      setDuration(audioRef.current.duration);
    }
  };

  const seek = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += seconds;
    }
  };

  const handleSleep = () => {
    if (sleepTimeout) {
      clearTimeout(sleepTimeout);
      setSleepTimeout(null);
    } else {
      const timeout = setTimeout(() => {
        stop();
      }, 15 * 60 * 1000); // 15 minutes
      setSleepTimeout(timeout);
    }
  };

  if (!current) return null;

  return (
    <div className="fixed bottom-0 left-0 w-full bg-white dark:bg-neutral-900 border-t border-black/10 dark:border-white/10 p-4 z-50 flex items-center justify-between gap-4">
      <Image
        src={current.thumbnail}
        alt="Episode thumbnail"
        width={48}
        height={48}
        className="rounded"
      />

      <div className="flex-1">
        <div className="text-sm font-medium truncate">{current.title}</div>
        <input
          type="range"
          min={0}
          max={duration}
          value={progress}
          onChange={(e) => {
            if (audioRef.current) {
              audioRef.current.currentTime = Number(e.target.value);
              setProgress(Number(e.target.value));
            }
          }}
          className="w-full accent-blue-500"
        />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => seek(-30)}><RotateCcw size={20} /></button>
        <button onClick={togglePlay}>
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <button onClick={() => seek(30)}><RotateCw size={20} /></button>
        <button onClick={handleSleep}><Timer size={20} /></button>
        <button onClick={() => alert('Transcript coming soon')}>
          <AlignLeft size={20} />
        </button>
      </div>

      <audio
        ref={audioRef}
        src={current.audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={stop}
        hidden
      />
    </div>
  );
}
