import { NextResponse } from "next/server";
import { listUsers } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json(await listUsers());
}
