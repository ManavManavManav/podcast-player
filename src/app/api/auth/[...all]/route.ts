import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/server/auth";

export async function GET(req: Request) {
  return toNextJsHandler(await getAuth()).GET(req);
}

export async function POST(req: Request) {
  return toNextJsHandler(await getAuth()).POST(req);
}
