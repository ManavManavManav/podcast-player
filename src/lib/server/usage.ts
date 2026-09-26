import { getDb } from "@/lib/server/db";

/** Paid API work done on a user's behalf, for the admin page. */
export interface Usage {
  audioSeconds: number;
  detectCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export const currentMonth = () => new Date().toISOString().slice(0, 7); // "2026-09"

export async function addUsage(userId: string, usage: Partial<Usage>) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO usage (user_id, month, audio_seconds, detect_calls, input_tokens, output_tokens)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, month) DO UPDATE SET
            audio_seconds = audio_seconds + excluded.audio_seconds,
            detect_calls = detect_calls + excluded.detect_calls,
            input_tokens = input_tokens + excluded.input_tokens,
            output_tokens = output_tokens + excluded.output_tokens`,
    args: [
      userId,
      currentMonth(),
      usage.audioSeconds ?? 0,
      usage.detectCalls ?? 0,
      usage.inputTokens ?? 0,
      usage.outputTokens ?? 0,
    ],
  });
}

/** Each user's usage for a month ("YYYY-MM"). */
export async function usageForMonth(month: string): Promise<Map<string, Usage>> {
  const db = await getDb();
  const { rows } = await db.execute({
    sql: "SELECT user_id, audio_seconds, detect_calls, input_tokens, output_tokens FROM usage WHERE month = ?",
    args: [month],
  });
  return new Map(
    rows.map((row) => [
      String(row.user_id),
      {
        audioSeconds: Number(row.audio_seconds),
        detectCalls: Number(row.detect_calls),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
      },
    ]),
  );
}

export async function deleteUsage(userId: string) {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM usage WHERE user_id = ?", args: [userId] });
}
