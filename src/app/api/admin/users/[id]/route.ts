import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { approveUser, listUsers } from "@/lib/server/admin";
import { getAuth } from "@/lib/server/auth";
import { rejectCrossSite } from "@/lib/server/guard";
import { requireAdmin } from "@/lib/server/session";
import { deleteUsage } from "@/lib/server/usage";

type Action = "approve" | "disable" | "enable" | "delete" | "set-password";
const ACTIONS: Action[] = ["approve", "disable", "enable", "delete", "set-password"];

/** Approves, disables, re-enables or deletes an account, or sets its password. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; password?: unknown };
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (id === admin.id && action !== "set-password") {
    return NextResponse.json({ error: "You can't do that to your own account" }, { status: 400 });
  }

  const target = (await listUsers()).find((u) => u.id === id);
  if (!target) return NextResponse.json({ error: "No such user" }, { status: 404 });

  // Better Auth's admin endpoints also revoke the user's sessions where it matters.
  const auth = await getAuth();
  const requestHeaders = await headers();
  try {
    switch (action) {
      case "approve":
        await approveUser(id);
        break;
      case "disable":
        await auth.api.banUser({ body: { userId: id, banReason: "Disabled by the admin" }, headers: requestHeaders });
        break;
      case "enable":
        await auth.api.unbanUser({ body: { userId: id }, headers: requestHeaders });
        break;
      case "delete":
        await auth.api.removeUser({ body: { userId: id }, headers: requestHeaders });
        await deleteUsage(id);
        break;
      case "set-password": {
        const password = body.password;
        if (typeof password !== "string" || password.length < 10 || password.length > 128) {
          return NextResponse.json({ error: "Use a password of 10 to 128 characters" }, { status: 400 });
        }
        await auth.api.setUserPassword({ body: { userId: id, newPassword: password }, headers: requestHeaders });
        break;
      }
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "That didn't work" }, { status: 500 });
  }
  return NextResponse.json(await listUsers());
}
