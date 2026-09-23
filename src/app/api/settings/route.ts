import { NextResponse, type NextRequest } from "next/server";
import { rejectCrossSite } from "@/lib/server/guard";
import { requireUser } from "@/lib/server/session";
import { getSettings, saveSettings, validateUpdate } from "@/lib/server/settings";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json(getSettings(user.id));
}

export async function PUT(req: NextRequest) {
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const update = validateUpdate(await req.json().catch(() => null));
  if (typeof update === "string") return NextResponse.json({ error: update }, { status: 400 });
  try {
    return NextResponse.json(saveSettings(user.id, update));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
