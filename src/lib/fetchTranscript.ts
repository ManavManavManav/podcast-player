// fetchTranscript.ts

let activeAbortController: AbortController | null = null;

/**
 * Cancels any in-progress transcription fetch.
 */
export function cancelTranscriptFetch() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    console.log("🛑 Transcription fetch aborted");
  }
}

/**
 * Fetches a transcript chunk from the API.
 * Automatically cancels any previous fetch.
 */
export async function fetchTranscriptChunk(url: string, start: number): Promise<string> {
  if (activeAbortController) {
    activeAbortController.abort();
  }

  activeAbortController = new AbortController();

  try {
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
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.info("🛑 Transcript fetch aborted");
    } else {
      throw err;
    }
    return ""; // or throw if you want to signal failure upward
  }
}
