/**
 * Field lab: try the Field's studies (src/lib/field/studies.ts) against real
 * sound, side by side with how they'd sit in the app. A temporary tool.
 *
 * Sound comes from a synthesized demo voice, an audio file, an episode link
 * (fetched through the lab server, so the browser may analyse it) or the
 * microphone, and is measured live with Web Audio into the same signal the
 * app uses.
 */

import { createSignal, unitFromDb, type Raw, type Signal } from "@/lib/field/signal";
import { STUDIES, STUDY_NAMES, createStudy, type Study, type StudyKind } from "@/lib/field/studies";

// --- State ------------------------------------------------------------------------------

type View = "stage" | "page";
type Source = "demo" | "file" | "link" | "mic";

const state = {
  kind: "filings" as StudyKind,
  view: "stage" as View,
  dark: false,
  strength: 0.6,
  source: "demo" as Source,
  playing: false,
  seed: 20260927,
};

const canvas = document.querySelector<HTMLCanvasElement>("#field")!;
const ctx = canvas.getContext("2d")!;
let width = 0;
let height = 0;
let dpr = 1;
const signal = createSignal();
let current: { study: Study; since: number } | null = null;
let leaving: { study: Study; since: number } | null = null;

const TRANSITION_IN = 1.4;
const TRANSITION_OUT = 0.7;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  current = { study: createStudy(state.kind, state.seed, width, height, state.view === "stage"), since: performance.now() / 1000 };
  leaving = null;
}

function choose(kind: StudyKind) {
  if (kind === state.kind && current) return;
  state.kind = kind;
  const now = performance.now() / 1000;
  leaving = current ? { study: current.study, since: now } : null;
  current = { study: createStudy(kind, state.seed, width, height, state.view === "stage"), since: now };
  render();
}

// --- Sound -------------------------------------------------------------------------------

const audio = new AudioContext();
const analyser = audio.createAnalyser();
analyser.fftSize = 2048;
analyser.smoothingTimeConstant = 0;
const speakers = audio.createGain();
speakers.connect(audio.destination);
const timeData = new Float32Array(analyser.fftSize);
const freqData = new Float32Array(analyser.frequencyBinCount);

/** The <audio> element for files and links, routed through the analyser once. */
const player = new Audio();
player.loop = true;
let playerRouted = false;
function routePlayer() {
  if (playerRouted) return;
  const node = audio.createMediaElementSource(player);
  node.connect(analyser);
  node.connect(speakers);
  playerRouted = true;
}

/** A synthesized voice: a buzz through moving vowel filters, in syllables, phrases and pauses. */
function demoVoice() {
  const out = audio.createGain();
  out.gain.value = 1.6;
  const buzz = audio.createOscillator();
  buzz.type = "sawtooth";
  buzz.frequency.value = 130;
  const envelope = audio.createGain();
  envelope.gain.value = 0;
  const formants = [audio.createBiquadFilter(), audio.createBiquadFilter()];
  for (const f of formants) {
    f.type = "bandpass";
    f.Q.value = 3;
    buzz.connect(f);
    f.connect(envelope);
  }
  // The voice's body: its fundamental and first harmonics, under the vowel filters.
  const body = audio.createBiquadFilter();
  body.type = "lowpass";
  body.frequency.value = 320;
  const bodyGain = audio.createGain();
  bodyGain.gain.value = 0.7;
  buzz.connect(body).connect(bodyGain).connect(envelope);
  envelope.connect(out);

  // Sibilants: filtered noise, now and then.
  const noise = audio.createBufferSource();
  const buffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  noise.buffer = buffer;
  noise.loop = true;
  const hiss = audio.createBiquadFilter();
  hiss.type = "bandpass";
  hiss.frequency.value = 5200;
  hiss.Q.value = 1.2;
  const hissGain = audio.createGain();
  hissGain.gain.value = 0;
  noise.connect(hiss).connect(hissGain).connect(out);

  buzz.start();
  noise.start();

  const vowels = [
    [300, 2300],
    [450, 1900],
    [650, 1200],
    [750, 1100],
    [400, 900],
  ];
  let cursor = audio.currentTime + 0.1;
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  const phrase = () => {
    const syllables = 5 + Math.floor(Math.random() * 9);
    const pitch = 120 + Math.random() * 40;
    for (let s = 0; s < syllables; s++) {
      const length = 0.13 + Math.random() * 0.16;
      const peak = 0.35 + Math.random() * 0.35;
      const [f1, f2] = pick(vowels);
      const at = cursor;
      if (Math.random() < 0.25) {
        hissGain.gain.setValueAtTime(0, at);
        hissGain.gain.linearRampToValueAtTime(0.35, at + 0.02);
        hissGain.gain.linearRampToValueAtTime(0, at + 0.07);
      }
      const voiced = at + 0.04;
      buzz.frequency.setTargetAtTime(pitch * (1 - (s / syllables) * 0.2) * (0.95 + Math.random() * 0.1), voiced, 0.03);
      formants[0].frequency.setTargetAtTime(f1, voiced, 0.02);
      formants[1].frequency.setTargetAtTime(f2, voiced, 0.02);
      envelope.gain.setValueAtTime(0, voiced);
      envelope.gain.linearRampToValueAtTime(peak, voiced + 0.025);
      envelope.gain.setValueAtTime(peak * 0.8, voiced + length - 0.04);
      envelope.gain.linearRampToValueAtTime(0, voiced + length);
      cursor = voiced + length + 0.015 + Math.random() * 0.05;
    }
    cursor += 0.45 + Math.random() * 1.1; // a pause between phrases
  };
  const timer = setInterval(() => {
    while (cursor < audio.currentTime + 1) phrase();
  }, 200);
  return {
    out,
    stop() {
      clearInterval(timer);
      buzz.stop();
      noise.stop();
      out.disconnect();
    },
  };
}

let demo: ReturnType<typeof demoVoice> | null = null;
let mic: MediaStreamAudioSourceNode | null = null;

function stopSound() {
  demo?.stop();
  demo = null;
  player.pause();
  if (mic) {
    mic.mediaStream.getTracks().forEach((track) => track.stop());
    mic.disconnect();
    mic = null;
  }
  state.playing = false;
}

async function startSound() {
  await audio.resume();
  stopSound();
  if (state.source === "demo") {
    demo = demoVoice();
    demo.out.connect(analyser);
    demo.out.connect(speakers);
  } else if (state.source === "mic") {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mic = audio.createMediaStreamSource(stream);
    mic.connect(analyser); // measured, not played back
  } else {
    if (!player.src) return;
    routePlayer();
    await player.play();
  }
  state.playing = true;
}

/** Loudness now, from the analyser, in the signal's terms. */
function measure(): Raw {
  if (!state.playing) return { level: 0, low: 0, high: 0, speaking: false, source: "live" };
  analyser.getFloatTimeDomainData(timeData);
  let sum = 0;
  for (const x of timeData) sum += x * x;
  const level = unitFromDb(10 * Math.log10(sum / timeData.length + 1e-12));
  analyser.getFloatFrequencyData(freqData);
  const hz = audio.sampleRate / analyser.fftSize;
  let lowPower = 0;
  let highPower = 0;
  freqData.forEach((db, bin) => {
    const f = bin * hz;
    if (f > 40 && f < 250) lowPower += 10 ** (db / 10);
    else if (f > 2000) highPower += 10 ** (db / 10);
  });
  // Band power from the spectrum sits a few dB above the waveform's RMS; bring it back in line.
  const low = unitFromDb(10 * Math.log10(lowPower + 1e-12) - 3);
  const high = unitFromDb(10 * Math.log10(highPower + 1e-12) + 6);
  return { level, low, high, speaking: level > 0.15, source: "live" };
}

// --- Drawing -----------------------------------------------------------------------------

let last = performance.now();
let latest: Signal | null = null;

function frame(nowMs: number) {
  const dt = Math.max(0, Math.min(0.1, (nowMs - last) / 1000));
  last = nowMs;
  const t = nowMs / 1000;
  const s = signal.stepRaw(measure(), state.playing, dt);
  latest = s;
  const stage = state.view === "stage";
  const intensity = 0.5 + state.strength;
  const inkColor = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const style = stage
    ? { ink: "#ffffff", alpha: 1, weight: 1.6 + 1.6 * state.strength }
    : { ink: inkColor, alpha: 0.03 + (0.05 + 0.06 * s.level) * (0.4 + state.strength), weight: 1 };

  if (leaving) {
    const out = (t - leaving.since) / TRANSITION_OUT;
    if (out >= 1) leaving = null;
    else {
      const f = { t, dt, signal: s, width, height, intensity, build: 1 - out };
      leaving.study.step(f);
      leaving.study.draw(ctx, { ...style, alpha: style.alpha * (1 - out) }, f);
    }
  }
  if (current) {
    const f = { t, dt, signal: s, width, height, intensity, build: Math.min(1, (t - current.since) / TRANSITION_IN) };
    current.study.step(f);
    current.study.draw(ctx, style, f);
  }
  meter(s);
  requestAnimationFrame(frame);
}

// --- Controls ----------------------------------------------------------------------------

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function meter(s: Signal) {
  for (const [key, value] of [
    ["level", s.level],
    ["low", s.low],
    ["high", s.high],
    ["onset", s.onset],
  ] as const) {
    $(`[data-meter="${key}"]`).style.setProperty("--fill", `${Math.round(value * 100)}%`);
  }
}

function render() {
  document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  document.body.dataset.view = state.view;
  canvas.dataset.view = state.view;
  $("#studies").replaceChildren(
    ...STUDIES.map((kind, i) => {
      const b = document.createElement("button");
      b.textContent = STUDY_NAMES[kind];
      b.title = `${STUDY_NAMES[kind]} (${i + 1})`;
      b.setAttribute("aria-pressed", String(kind === state.kind));
      b.onclick = () => choose(kind);
      return b;
    }),
  );
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-source]")) {
    b.setAttribute("aria-pressed", String(b.dataset.source === state.source));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
  }
  $("#theme").textContent = state.dark ? "Dark" : "Light";
  $("#play").textContent = state.playing ? "Pause" : "Play";
  $("#strength").style.setProperty("--fill", `${Math.round(state.strength * 100)}%`);
  const micOk = Boolean(navigator.mediaDevices?.getUserMedia);
  const micButton = $<HTMLButtonElement>('[data-source="mic"]');
  micButton.disabled = !micOk;
  micButton.title = micOk ? "Microphone" : "The microphone needs https or localhost";
}

async function selectSource(source: Source) {
  if (source === "file") {
    $<HTMLInputElement>("#file").click();
    return;
  }
  if (source === "link") {
    const url = window.prompt("Link to an episode's audio (mp3, m4a…)");
    if (!url) return;
    player.src = `/proxy?url=${encodeURIComponent(url.trim())}`;
  }
  state.source = source;
  await startSound().catch((err) => alert(`Couldn't start the sound: ${err.message}`));
  render();
}

$<HTMLInputElement>("#file").onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  player.src = URL.createObjectURL(file);
  state.source = "file";
  await startSound().catch((err) => alert(`Couldn't play that file: ${err.message}`));
  render();
};
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-source]")) {
  b.onclick = () => selectSource(b.dataset.source as Source);
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  b.onclick = () => {
    state.view = b.dataset.view as View;
    resize();
    render();
  };
}
$("#theme").onclick = () => {
  state.dark = !state.dark;
  render();
};
$("#play").onclick = async () => {
  if (state.playing) {
    stopSound();
    render();
  } else await selectSource(state.source);
};
const strength = $("#strength");
const setStrength = (clientX: number) => {
  const rect = strength.getBoundingClientRect();
  state.strength = Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 20) / 20;
  render();
};
strength.onpointerdown = (e) => {
  strength.setPointerCapture(e.pointerId);
  setStrength(e.clientX);
};
strength.onpointermove = (e) => e.buttons === 1 && setStrength(e.clientX);
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const n = Number(e.key);
  if (n >= 1 && n <= STUDIES.length) choose(STUDIES[n - 1]);
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const step = e.key === "ArrowRight" ? 1 : -1;
    choose(STUDIES[(STUDIES.indexOf(state.kind) + step + STUDIES.length) % STUDIES.length]);
  } else if (e.key === " ") {
    e.preventDefault();
    $("#play").click();
  } else return;
});
window.addEventListener("resize", resize);

resize();
render();
requestAnimationFrame(frame);
// For checking from dev tools and scripts.
Object.assign(window, { lab: { state, choose, signal: () => latest } });
