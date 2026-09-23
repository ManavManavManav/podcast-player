"use client";

import { useEffect, useRef } from "react";
import { LOOKAHEAD_WINDOWS, WINDOW_SECONDS, windowStartFor } from "@/lib/analysis";
import type { AnalyzeResponse } from "@/lib/types";
import { useAnalysis } from "@/store/analysis";
import { usePlayback, usePlayer } from "@/store/player";

/** Requests in flight at once. Two lets audio fetching overlap transcription. */
const CONCURRENCY = 2;
/** After this many failures in a row, stop and surface the error. */
const MAX_CONSECUTIVE_ERRORS = 3;
const RETRY_DELAY_MS = 8_000;

/**
 * Keeps the transcript analyzed from the playhead up to a few minutes ahead,
 * so ads are known before playback reaches them. Windows that a seek has made
 * irrelevant are cancelled.
 */
export function useAdScanner(enabled: boolean) {
  const language = usePlayer((s) => s.episode?.language);
  const url = usePlayback((s) => s.source);
  const duration = usePlayback((s) => s.duration);
  const playheadWindow = usePlayback((s) => windowStartFor(s.currentTime));
  const windows = useAnalysis((s) => s.windows);
  const error = useAnalysis((s) => s.error);

  const controllers = useRef(new Map<number, AbortController>());
  const failures = useRef(0);
  const retryTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  // New episode: drop everything from the previous one.
  useEffect(() => {
    const inflight = controllers.current;
    const timers = retryTimers.current;
    useAnalysis.getState().reset(url);
    failures.current = 0;
    if (url) {
      // Show whatever was analyzed on a previous listen right away.
      void fetch(`/api/analyze?url=${encodeURIComponent(url)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((cached) => {
          if (cached && useAnalysis.getState().url === url) useAnalysis.getState().restore(cached);
        })
        .catch(() => {});
    }
    return () => {
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, [url]);

  // Retrying after the scanner gave up starts the failure count over.
  useEffect(() => {
    if (!error) failures.current = 0;
  }, [error]);

  useEffect(() => {
    if (!enabled || !url || error) return;

    const lastWindow = duration > 0 ? windowStartFor(duration - 0.01) : Infinity;
    const wanted: number[] = [];
    for (let i = 0; i <= LOOKAHEAD_WINDOWS; i++) {
      const w = playheadWindow + i * WINDOW_SECONDS;
      if (w <= lastWindow) wanted.push(w);
    }

    // Cancel work for windows the listener has seeked away from.
    for (const [w, controller] of controllers.current) {
      if (!wanted.includes(w)) {
        controller.abort();
        controllers.current.delete(w);
        useAnalysis.getState().clearStatus(w);
      }
    }

    for (const w of wanted) {
      if (controllers.current.size >= CONCURRENCY) break;
      const status = windows[w];
      if (status === "done" || status === "pending" || status === "error") continue;

      const controller = new AbortController();
      controllers.current.set(w, controller);
      // Free the slot before touching state, so the effect that state change
      // triggers can schedule the next window.
      const release = () => {
        if (controllers.current.get(w) === controller) controllers.current.delete(w);
      };
      useAnalysis.getState().setStatus(w, "pending");

      void fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, window: w, language }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Analysis failed (${res.status})`);
          }
          const body = (await res.json()) as AnalyzeResponse;
          if (!Array.isArray(body.segments) || !Array.isArray(body.ads)) {
            throw new Error("The server sent an unexpected response");
          }
          return body;
        })
        .then((result) => {
          release();
          if (useAnalysis.getState().url !== url) return;
          failures.current = 0;
          useAnalysis.getState().addWindow(w, result.segments, result.ads, result.detector, result.detectorError);
        })
        .catch((err: Error) => {
          release();
          if (err.name === "AbortError" || useAnalysis.getState().url !== url) return;
          failures.current += 1;
          const analysis = useAnalysis.getState();
          analysis.setStatus(w, "error");
          if (failures.current >= MAX_CONSECUTIVE_ERRORS) {
            analysis.setError(err.message);
          } else {
            // Clear the error mark after a pause so the window is retried.
            const timer = setTimeout(() => {
              retryTimers.current.delete(timer);
              if (useAnalysis.getState().windows[w] === "error") useAnalysis.getState().clearStatus(w);
            }, RETRY_DELAY_MS);
            retryTimers.current.add(timer);
          }
        });
    }
  }, [enabled, url, language, duration, playheadWindow, windows, error]);
}

/** Clears a scanner error so it tries again. */
export function retryScanning() {
  const state = useAnalysis.getState();
  const windows = Object.fromEntries(
    Object.entries(state.windows).filter(([, status]) => status !== "error"),
  );
  useAnalysis.setState({ windows, error: null });
}
