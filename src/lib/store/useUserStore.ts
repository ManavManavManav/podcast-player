// lib/store/useUserStore.ts
import { create } from 'zustand';

type UserStore = {
  username: string | null;
  setUsername: (name: string) => void;
  logout: () => void;
};

export const useUserStore = create<UserStore>((set) => ({
  username: null,
  setUsername: (name) => {
    localStorage.setItem('username', name);
    set({ username: name });
  },
  logout: () => {
    localStorage.removeItem('username');
    set({ username: null });
  },
}));
