import { readState } from "@/lib/server/engine";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const tz = new URL(req.url).searchParams.get("tz");
  return Response.json(readState(tz === null ? null : Number(tz)));
}
