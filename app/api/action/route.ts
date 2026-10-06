import { dispatch } from "@/lib/server/engine";
import type { Action } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPES = new Set<Action["type"]>([
  "create_task", "run_task", "run_all", "delegate", "assign_me", "start_task", "complete_task",
  "approve_job", "reject_job", "cancel_job", "retry_job", "accept_opportunity", "dismiss_opportunity",
  "set_autopilot", "analyze", "reorder", "delegation_answer", "dismiss_day_update", "reset",
]);

export async function POST(req: Request) {
  const tz = new URL(req.url).searchParams.get("tz");
  let action: Action;
  try {
    action = (await req.json()) as Action;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!action || !TYPES.has(action.type)) return Response.json({ error: "Unknown action" }, { status: 400 });
  if (action.type === "create_task" && (typeof action.title !== "string" || action.title.length > 500)) {
    return Response.json({ error: "Invalid title" }, { status: 400 });
  }
  return Response.json(await dispatch(action, tz === null ? null : Number(tz)));
}
