// src/store/audioStore.ts
import { create } from 'zustand';

type Episode = {
  id: string;
  title: string;
  enclosureUrl: string;
};

interface AudioState {
  currentEpisode: Episode | null;
  progress: number; // value between 0 and 1
  setCurrentEpisode: (ep: Episode) => void;
  setProgress: (progress: number) => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  currentEpisode: null,
  progress: 0,
  setCurrentEpisode: (ep) => set({ currentEpisode: ep, progress: 0 }),
  setProgress: (progress) => set({ progress }),
}));
