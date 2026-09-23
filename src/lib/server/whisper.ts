import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import type { TranscriptSegment } from "@/lib/types";

const execFileAsync = promisify(execFile);

const WORKER_SCRIPT = path.join(process.cwd(), "worker", "transcriber.py");
/** First start may download the model (~140 MB for "base"), so be generous. */
const STARTUP_TIMEOUT_MS = 5 * 60_000;
const IDLE_SHUTDOWN_MS = 10 * 60_000;

export const whisperModel = process.env.WHISPER_MODEL || "base";

interface Job {
  id: string;
  path: string;
  language?: string;
  resolve: (segments: TranscriptSegment[]) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
}

// --- Finding a Python that has openai-whisper installed ----------------------

async function canImportWhisper(python: string): Promise<boolean> {
  try {
    await execFileAsync(python, ["-c", "import whisper"], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

/** The interpreter named in the `whisper` CLI's shebang, if it's installed. */
async function pythonFromWhisperCli(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", ["whisper"]);
    const cli = stdout.trim();
    if (!cli) return null;
    const firstLine = (await fs.readFile(cli, "utf-8")).split("\n", 1)[0];
    return firstLine.startsWith("#!") ? firstLine.slice(2).trim().split(" ")[0] : null;
  } catch {
    return null;
  }
}

async function findPython(): Promise<string | null> {
  const candidates = [
    process.env.WHISPER_PYTHON,
    await pythonFromWhisperCli(),
    "python3",
    "python",
  ].filter((c): c is string => Boolean(c));

  for (const python of new Set(candidates)) {
    if (await canImportWhisper(python)) return python;
  }
  return null;
}

// --- Worker process ----------------------------------------------------------

class WhisperWorker {
  private python: Promise<string | null> | null = null;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  lastError: string | null = null;

  resolvePython(): Promise<string | null> {
    this.python ??= findPython();
    return this.python;
  }

  transcribe(
    wavPath: string,
    language?: string,
    signal?: AbortSignal,
  ): Promise<TranscriptSegment[]> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const job: Job = { id: randomUUID(), path: wavPath, language, resolve, reject, signal };

      // A job that hasn't reached Python yet can simply be dropped.
      signal?.addEventListener(
        "abort",
        () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) {
            this.queue.splice(index, 1);
            reject(new DOMException("Aborted", "AbortError"));
          }
        },
        { once: true },
      );

      this.queue.push(job);
      void this.pump();
    });
  }

  private async start(): Promise<void> {
    const python = await this.resolvePython();
    if (!python) {
      throw new Error(
        "Couldn't find a Python with openai-whisper installed. Run `pip install openai-whisper` or set WHISPER_PYTHON.",
      );
    }

    const proc = spawn(python, ["-u", WORKER_SCRIPT], {
      env: { ...process.env, WHISPER_MODEL: whisperModel },
    });
    this.proc = proc;
    // Writing to the pipe of a worker that just died raises EPIPE here; left
    // unhandled it would crash the server. The "exit" handler recovers.
    proc.stdin.on("error", () => {});

    const lines = readline.createInterface({ input: proc.stdout });
    let stderrTail = "";
    proc.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    let started = false;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error("Whisper worker took too long to start"));
      }, STARTUP_TIMEOUT_MS);

      lines.on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.ready) {
          clearTimeout(timer);
          started = true;
          resolve();
        } else if (typeof message.fatal === "string") {
          clearTimeout(timer);
          reject(new Error(message.fatal));
        } else {
          this.onResult(message);
        }
      });

      // A failed spawn emits "error" and may never emit "exit".
      proc.on("error", (err) => {
        clearTimeout(timer);
        if (!started) reject(err);
        else proc.kill();
      });

      proc.on("exit", (code) => {
        clearTimeout(timer);
        const err = new Error(
          `Whisper worker exited (code ${code})${stderrTail ? `: ${stderrTail.trim().split("\n").pop()}` : ""}`,
        );
        // Idle shutdown detaches the process before killing it, so an exit
        // from a detached process is expected and not a crash.
        const crashed = this.proc === proc;
        if (crashed) this.proc = null;
        // A failed start is reported through the rejected promise; only a
        // worker that was running goes through crash recovery.
        if (!started) reject(err);
        else if (crashed) this.onExit(err);
      });
    });
  }

  private onResult(message: Record<string, unknown>) {
    const job = this.current;
    if (!job || message.id !== job.id) return;
    this.current = null;
    if (typeof message.error === "string") job.reject(new Error(message.error));
    else job.resolve((message.segments as TranscriptSegment[]) ?? []);
    void this.pump();
  }

  private onExit(err: Error) {
    this.ready = null;
    this.lastError = err.message;
    this.current?.reject(err);
    this.current = null;
    // Restart for whatever is still queued.
    if (this.queue.length) void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.current || this.queue.length === 0) return this.scheduleIdleShutdown();
    this.clearIdleShutdown();

    try {
      this.ready ??= this.start();
      await this.ready;
      this.lastError = null;
    } catch (err) {
      this.ready = null;
      this.lastError = (err as Error).message;
      for (const job of this.queue.splice(0)) job.reject(err as Error);
      return;
    }

    if (this.current || this.queue.length === 0) return;
    if (!this.proc) {
      // Exited between becoming ready and now; start a fresh one.
      this.ready = null;
      return this.pump();
    }
    const job = this.queue.shift()!;
    this.current = job;
    this.proc.stdin.write(
      JSON.stringify({ id: job.id, path: job.path, language: job.language }) + "\n",
    );
  }

  private scheduleIdleShutdown() {
    if (!this.proc || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.current || this.queue.length > 0) return;
      const proc = this.proc;
      this.proc = null;
      this.ready = null;
      proc?.kill();
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref();
  }

  private clearIdleShutdown() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

// Survive Next.js dev-mode module reloads: one worker per server process.
const globalForWhisper = globalThis as unknown as { __podblockWhisper?: WhisperWorker };
export const whisper = (globalForWhisper.__podblockWhisper ??= new WhisperWorker());
