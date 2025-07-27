// fetchTranscript.ts

export async function fetchTranscriptChunk(url: string, start: number): Promise<string> {
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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

  console.log(`✅ Received chunk for ${start}s`, data.transcript.slice(0, 200));
  return data.transcript;
}
