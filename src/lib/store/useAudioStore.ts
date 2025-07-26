// lib/store/useAudioStore.ts
import { create } from 'zustand';

type AudioEpisode = {
  title: string;
  audioUrl: string;
  thumbnail: string;
};

type AudioState = {
  current: AudioEpisode | null;
  isPlaying: boolean;
  setEpisode: (episode: AudioEpisode) => void;
  togglePlay: () => void;
  stop: () => void;
};

export const useAudioStore = create<AudioState>((set) => ({
  current: null,
  isPlaying: false,
  setEpisode: (episode) => set({ current: episode, isPlaying: true }),
  togglePlay: () =>
    set((state) => ({ isPlaying: !state.isPlaying })),
  stop: () => set({ current: null, isPlaying: false }),
}));
