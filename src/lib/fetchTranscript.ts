// fetchTranscript.ts

let activeAbortController: AbortController | null = null;

export async function fetchTranscriptChunk(url: string, start: number): Promise<string> {
  // Cancel any ongoing request if a new one is triggered (e.g., scrubbing)
  if (activeAbortController) {
    activeAbortController.abort();
  }

  activeAbortController = new AbortController();

  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal: activeAbortController.signal,
    body: JSON.stringify({ url, start }),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error("❌ Transcription API error:", error);
    throw new Error("Failed to fetch transcript chunk");
  }

  const data = await res.json();
  if (!data?.transcript) {
    console.warn("⚠️ No transcript returned in response:", data);
    throw new Error("Transcript data missing");
  }
  return data.transcript;
}
