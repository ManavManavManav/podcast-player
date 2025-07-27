// ✅ transcriptionStore.ts
import { create } from 'zustand';

interface TranscriptionState {
  visible: boolean;
  loading: boolean;
  text: string;
  chunkMap: Map<number, string>;
  toggleVisible: () => void;
  setLoading: (loading: boolean) => void;
  setText: (text: string) => void;
  clear: () => void;
  setChunk: (start: number, chunkText: string) => void;
}

export const useTranscriptionStore = create<TranscriptionState>((set) => ({
  visible: false,
  loading: false,
  text: '',
  chunkMap: new Map(),
  toggleVisible: () => set((state) => ({ visible: !state.visible })),
  setLoading: (loading) => set({ loading }),
  setText: (text) => set({ text }),
  clear: () => set({ text: '', chunkMap: new Map() }),
  setChunk: (start, chunkText) =>
    set((state) => {
      const updatedMap = new Map(state.chunkMap);
      updatedMap.set(start, chunkText);
      return { chunkMap: updatedMap };
    }),
}));


// ✅ fetchTranscript.ts
export async function fetchTranscriptChunk(url: string, start: number): Promise<string> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, start }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Transcription failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.transcript as string;
}