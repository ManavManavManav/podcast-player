import type { AdminUser } from "@/lib/types";
import { getDb } from "@/lib/server/db";
import { currentMonth, usageForMonth } from "@/lib/server/usage";

/** Every account, pending ones first, with this month's API usage. */
export async function listUsers(): Promise<AdminUser[]> {
  const db = await getDb();
  const [{ rows }, usage] = await Promise.all([
    db.execute(`SELECT id, name, email, role, approved, banned, "createdAt" FROM "user"`),
    usageForMonth(currentMonth()),
  ]);
  const users = rows.map((row): AdminUser => {
    const id = String(row.id);
    const role = row.role === "admin" ? "admin" : "user";
    const u = usage.get(id);
    return {
      id,
      name: String(row.name ?? ""),
      email: String(row.email),
      role,
      approved: role === "admin" || Boolean(Number(row.approved)),
      banned: Boolean(Number(row.banned)),
      createdAt: new Date(Number(row.createdAt) || String(row.createdAt)).toISOString(),
      usage: {
        audioMinutes: Math.round((u?.audioSeconds ?? 0) / 60),
        detectCalls: u?.detectCalls ?? 0,
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
      },
    };
  });
  // Waiting for approval first, then newest.
  return users.sort((a, b) => Number(a.approved) - Number(b.approved) || b.createdAt.localeCompare(a.createdAt));
}

export async function approveUser(userId: string) {
  const db = await getDb();
  await db.execute({ sql: `UPDATE "user" SET approved = 1 WHERE id = ?`, args: [userId] });
}
