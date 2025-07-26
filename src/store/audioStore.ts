// src/store/audioStore.ts
import { create } from 'zustand';

type Episode = {
  id: string;
  title: string;
  enclosureUrl: string;
};

interface AudioState {
  currentEpisode: Episode | null;
  setCurrentEpisode: (ep: Episode) => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  currentEpisode: null,
  setCurrentEpisode: (ep) => set({ currentEpisode: ep }),
}));
