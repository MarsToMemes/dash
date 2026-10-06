// The Chief of Staff's reasoning, as pure functions over workspace state.
// Shared by the server engine (ranking, health, opportunities) and the UI
// (next move, workforce split, timeline, briefings) so both always agree.

import { AGENTS } from "./agents.ts";
import type {
  AgentJob,
  Opportunity,
  Priority,
  Project,
  ProjectHealth,
  Settings,
  Task,
  TaskDraft,
  WorkspaceState,
} from "./types.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const PRIORITY_WEIGHT: Record<Priority, number> = { critical: 40, high: 25, medium: 10, low: 0 };

export const OPEN_STATUSES = new Set(["todo", "ai_queued", "ai_running", "awaiting_approval", "your_turn", "waiting"]);

export function isOpen(t: Task): boolean {
  return OPEN_STATUSES.has(t.status);
}

/** Dependencies resolved? */
export function isUnblocked(task: Task, byId: Map<string, Task>): boolean {
  return task.dependsOn.every((id) => {
    const dep = byId.get(id);
    return !dep || dep.status === "done" || dep.status === "cancelled";
  });
}

/** Tasks that need Rémi's personal attention right now. */
export function isHumanAction(task: Task, byId: Map<string, Task>): boolean {
  if (task.isMission || !isUnblocked(task, byId)) return false;
  if (task.status === "your_turn" || task.status === "awaiting_approval") return true;
  return task.status === "todo" && (task.mode === "YOU" || task.keptHuman);
}

/**
 * How much Rémi's attention is worth on this task, right now.
 * High human value dominates; time pressure and unblocking power break ties.
 */
export function humanScore(task: Task, all: Task[], now: number): number {
  let s = task.humanValue * 20 + PRIORITY_WEIGHT[task.priority];
  if (task.scheduledAt) {
    const delta = task.scheduledAt - now;
    if (delta < -15 * MIN) s += 10; // overdue — still matters, but don't let it hijack the day
    else if (delta <= 45 * MIN) s += 35; // imminent
    else if (delta <= 3 * HOUR) s += 12;
    else s -= 10; // later today: don't start it now
  }
  if (task.status === "your_turn") s += 18; // AI already did its part — finish the loop
  if (task.status === "awaiting_approval") s += 8;
  const unblocks = all.filter((t) => t.dependsOn.includes(task.id) && isOpen(t)).length;
  s += Math.min(unblocks, 3) * 6;
  // Quick wins get a small nudge: momentum matters.
  if (task.humanMinutes > 0 && task.humanMinutes <= 15) s += 4;
  return s;
}

/** Score for AI-side work: what should the workforce pick up first. */
export function aiScore(task: Task, all: Task[]): number {
  let s = PRIORITY_WEIGHT[task.priority] + task.manualMinutes / 10;
  // Prep that feeds a human action is urgent: the human is waiting on it.
  const feedsHuman = all.some((t) => t.dependsOn.includes(task.id) && (t.mode === "YOU" || t.mode === "AI_YOU"));
  if (feedsHuman || task.parentId) s += 25;
  return s;
}

export function rankTasks(tasks: Task[], now: number): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const open = tasks.filter(isOpen);
  const human = open
    .filter((t) => isHumanAction(t, byId))
    .sort((a, b) => humanScore(b, tasks, now) - humanScore(a, tasks, now));
  const rest = open
    .filter((t) => !isHumanAction(t, byId))
    .sort((a, b) => aiScore(b, tasks) - aiScore(a, tasks));
  const ranks = new Map<string, number>();
  [...human, ...rest].forEach((t, i) => ranks.set(t.id, i));
  return ranks;
}

/** THE ONE THING ONLY YOU CAN DO RIGHT NOW. */
export function nextMove(state: Pick<WorkspaceState, "tasks">, now: number): Task | null {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const human = state.tasks.filter((t) => isOpen(t) && isHumanAction(t, byId));
  if (human.length === 0) return null;
  // Rank (from the last analysis / manual reorder) wins; score breaks ties for new tasks.
  return human.sort((a, b) => a.rank - b.rank || humanScore(b, state.tasks, now) - humanScore(a, state.tasks, now))[0];
}

export interface Workforce {
  you: Task[];
  ai: { task: Task; job: AgentJob | null }[];
  suggested: Task[];
  waiting: Task[];
  recentlyDone: { task: Task; job: AgentJob | null }[];
}

export function latestJob(jobs: AgentJob[], taskId: string): AgentJob | null {
  let best: AgentJob | null = null;
  for (const j of jobs) if (j.task_id === taskId && (!best || j.created_at > best.created_at)) best = j;
  return best;
}

export function workforce(state: Pick<WorkspaceState, "tasks" | "jobs">, now: number): Workforce {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const byRank = [...state.tasks].sort((a, b) => a.rank - b.rank);
  const you = byRank.filter((t) => isOpen(t) && isHumanAction(t, byId));
  const ai = byRank
    .filter((t) => t.status === "ai_running" || t.status === "ai_queued")
    .map((task) => ({ task, job: latestJob(state.jobs, task.id) }))
    .sort((a, b) => statusOrder(a.job) - statusOrder(b.job) || a.task.rank - b.task.rank);
  const suggested = byRank.filter(
    (t) => t.status === "todo" && !t.isMission && (t.mode === "AI" || t.mode === "AI_YOU") && !t.keptHuman && isUnblocked(t, byId),
  );
  const waiting = byRank.filter((t) => t.status === "waiting" || (t.status === "todo" && t.mode === "WAITING"));
  const recentlyDone = state.tasks
    .filter((t) => t.status === "done" && t.completedAt && now - t.completedAt < 6 * HOUR)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .map((task) => ({ task, job: latestJob(state.jobs, task.id) }));
  return { you, ai, suggested, waiting, recentlyDone };
}

function statusOrder(job: AgentJob | null): number {
  if (!job) return 3;
  return job.status === "RUNNING" ? 0 : job.status === "QUEUED" ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Time

export function localMinuteOfDay(now: number, tzOffsetMin: number): number {
  const local = new Date(now - tzOffsetMin * MIN);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** Epoch ms for "today at minute-of-day m" in the user's timezone. */
export function todayAt(now: number, tzOffsetMin: number, minuteOfDay: number): number {
  const local = new Date(now - tzOffsetMin * MIN);
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() + tzOffsetMin * MIN + minuteOfDay * MIN;
}

export function endOfDay(now: number, settings: Settings): number {
  return todayAt(now, settings.tzOffsetMin, settings.dayEndMin);
}

/** Free minutes left today once committed human work is subtracted. */
export function availableMinutes(state: Pick<WorkspaceState, "tasks" | "settings">, now: number): number {
  const end = endOfDay(now, state.settings);
  const left = Math.max(0, (end - now) / MIN);
  const committed = state.tasks
    .filter((t) => isOpen(t) && t.scheduledAt && t.scheduledAt >= now && t.scheduledAt < end)
    .reduce((s, t) => s + t.humanMinutes, 0);
  return Math.max(0, Math.round(left - committed));
}

export interface PlanSlot {
  task: Task;
  start: number;
  end: number;
  lane: "you" | "ai";
  fixed: boolean;
}

/**
 * Lay out the rest of today. Scheduled human tasks are fixed; other human
 * actions fill the gaps in rank order; AI jobs run in a parallel lane, one
 * per agent, back to back.
 */
export function planDay(state: Pick<WorkspaceState, "tasks" | "jobs" | "settings">, now: number): PlanSlot[] {
  const end = endOfDay(now, state.settings);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const slots: PlanSlot[] = [];

  const fixed = state.tasks
    .filter((t) => isOpen(t) && t.scheduledAt && t.scheduledAt < end && t.scheduledAt + t.humanMinutes * MIN > now)
    .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  for (const t of fixed) {
    slots.push({ task: t, start: t.scheduledAt!, end: t.scheduledAt! + Math.max(10, t.humanMinutes) * MIN, lane: "you", fixed: true });
  }

  const flexible = state.tasks
    .filter((t) => isOpen(t) && !t.scheduledAt && isHumanAction(t, byId) && t.humanMinutes > 0)
    .sort((a, b) => a.rank - b.rank);
  let cursor = roundUp(now, 5 * MIN);
  for (const t of flexible) {
    const dur = t.humanMinutes * MIN;
    // skip over fixed blocks
    for (;;) {
      const clash = slots.find((s) => s.lane === "you" && s.start < cursor + dur && s.end > cursor);
      if (!clash) break;
      cursor = roundUp(clash.end + 5 * MIN, 5 * MIN);
    }
    if (cursor + dur > end) break;
    slots.push({ task: t, start: cursor, end: cursor + dur, lane: "you", fixed: false });
    cursor = roundUp(cursor + dur + 5 * MIN, 5 * MIN);
  }

  // AI lane: running jobs end at their ETA, queued ones follow per agent.
  const agentCursor = new Map<string, number>();
  const active = state.jobs
    .filter((j) => j.status === "RUNNING" || j.status === "QUEUED")
    .sort((a, b) => (a.status === "RUNNING" ? -1 : 1) - (b.status === "RUNNING" ? -1 : 1) || a.created_at - b.created_at);
  for (const j of active) {
    const task = byId.get(j.task_id);
    if (!task) continue;
    const dur = task.aiMinutes * MIN;
    const start = j.status === "RUNNING" && j.started_at ? j.started_at : Math.max(now, agentCursor.get(j.agent) ?? now);
    const finish = j.status === "RUNNING" ? start + dur : start + dur;
    agentCursor.set(j.agent, finish);
    slots.push({ task, start, end: finish, lane: "ai", fixed: false });
  }
  return slots.sort((a, b) => a.start - b.start);
}

function roundUp(t: number, step: number): number {
  return Math.ceil(t / step) * step;
}

// ---------------------------------------------------------------------------
// Value metrics

export function timeSaved(jobs: AgentJob[], since: number): { minutes: number; count: number } {
  let minutes = 0;
  let count = 0;
  for (const j of jobs) {
    if (j.status === "COMPLETED" && j.completed_at && j.completed_at >= since) {
      minutes += j.saved_minutes;
      count++;
    }
  }
  return { minutes, count };
}

export function startOfWeek(now: number, tzOffsetMin: number): number {
  const local = new Date(now - tzOffsetMin * MIN);
  const day = (local.getUTCDay() + 6) % 7; // Monday = 0
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() - day * DAY + tzOffsetMin * MIN;
}

export function startOfToday(now: number, tzOffsetMin: number): number {
  return todayAt(now, tzOffsetMin, 0);
}

// ---------------------------------------------------------------------------
// Projects

export function projectProgress(project: Project, tasks: Task[]): number {
  const mine = tasks.filter((t) => t.projectId === project.id && t.status !== "cancelled" && !t.isMission);
  const total = mine.length + project.legacyDone;
  if (total === 0) return project.progress;
  return (mine.filter((t) => t.status === "done").length + project.legacyDone) / total;
}

export function computeHealth(project: Project, tasks: Task[], now: number): ProjectHealth {
  const open = tasks.filter((t) => t.projectId === project.id && isOpen(t));
  if (open.length === 0) return "idle";
  const stale = now - project.lastActivityAt > 4 * DAY;
  const overdueHuman = open.some((t) => t.scheduledAt && t.scheduledAt < now - HOUR && t.mode !== "AI");
  const waitingLong = open.some((t) => t.status === "waiting" && now - t.createdAt > 3 * DAY);
  if (stale && open.length > 0) return "attention";
  if (overdueHuman || waitingLong) return "at_risk";
  return "on_track";
}

export type PipelineStage = "IDEA" | "AI PREP" | "HUMAN REVIEW" | "HUMAN ACTION" | "AI FOLLOW-UP" | "DONE";
export const PIPELINE: PipelineStage[] = ["IDEA", "AI PREP", "HUMAN REVIEW", "HUMAN ACTION", "AI FOLLOW-UP", "DONE"];

/** Where a mission (a task and its children / a project) sits in the human+AI pipeline. */
export function pipelineStage(tasks: Task[]): PipelineStage {
  const open = tasks.filter(isOpen);
  if (tasks.length > 0 && open.length === 0) return "DONE";
  const done = tasks.filter((t) => t.status === "done");
  if (open.some((t) => t.status === "ai_running" || t.status === "ai_queued")) {
    const humanDone = done.some((t) => t.mode === "YOU");
    return humanDone ? "AI FOLLOW-UP" : "AI PREP";
  }
  if (open.some((t) => t.status === "awaiting_approval" || t.status === "your_turn" || t.humanKind === "review")) return "HUMAN REVIEW";
  if (open.some((t) => t.mode === "YOU")) return done.length > 0 ? "HUMAN ACTION" : "IDEA";
  if (open.some((t) => t.mode === "AI" || t.mode === "AI_YOU")) return done.length > 0 ? "AI FOLLOW-UP" : "IDEA";
  return "IDEA";
}

// ---------------------------------------------------------------------------
// Proactive discovery — AI creates work from project state.

export interface OpportunityProposal {
  key: string;
  projectId: string | null;
  title: string;
  summary: string;
  drafts: TaskDraft[];
}

export function discoverOpportunities(state: Pick<WorkspaceState, "projects" | "tasks">, now: number): OpportunityProposal[] {
  const out: OpportunityProposal[] = [];
  for (const p of state.projects) {
    const mine = state.tasks.filter((t) => t.projectId === p.id);
    const has = (tag: string) => mine.some((t) => t.tags.some((x) => x.toLowerCase() === tag));
    const progress = projectProgress(p, state.tasks);

    // Almost finished, nothing to show for it yet → portfolio case study.
    if (progress >= 0.8 && p.stage === "building" && !has("case study")) {
      out.push({
        key: `case-study:${p.id}`,
        projectId: p.id,
        title: `${p.name} is ready for a case study`,
        summary: `Your ${p.name} project is ${Math.round(progress * 100)}% complete but has no portfolio case study. I can prepare everything — you only approve and publish.`,
        drafts: [
          { title: `Capture ${p.name} screenshots`, mode: "AI", agent: "design", tags: ["Case study", "Design"] },
          { title: `Write ${p.name} case-study structure and copy`, mode: "AI", agent: "content", tags: ["Case study", "Content"] },
          { title: `Approve and publish ${p.name} case study`, mode: "YOU", humanKind: "decision", tags: ["Case study"], after: [0, 1], risk: "medium" },
        ],
      });
    }

    if (p.stage === "deployed" && !has("launch")) {
      out.push({
        key: `post-launch:${p.id}`,
        projectId: p.id,
        title: `${p.name} is live — run post-launch checks`,
        summary: `${p.name} was deployed. I'll audit performance and mobile, then fix what's critical. You only approve the fixes before they reach production.`,
        drafts: [
          { title: `Run ${p.name} performance audit`, mode: "AI", agent: "analyst", tags: ["Launch", "Analysis"] },
          { title: `Run ${p.name} mobile QA`, mode: "AI", agent: "coding", tags: ["Launch", "Code"] },
          { title: `Fix critical ${p.name} issues`, mode: "AI", agent: "coding", tags: ["Launch", "Code"], after: [0, 1], risk: "medium" },
        ],
      });
    }

    const stale = now - p.lastActivityAt > 4 * DAY && mine.some(isOpen);
    if (stale) {
      out.push({
        key: `stalled:${p.id}`,
        projectId: p.id,
        title: `${p.name} has stalled`,
        summary: `No progress on ${p.name} for ${Math.floor((now - p.lastActivityAt) / DAY)} days. I can diagnose what's blocking it; the keep-or-kill call is yours.`,
        drafts: [
          { title: `Diagnose what's blocking ${p.name}`, mode: "AI", agent: "analyst", tags: ["Analysis"] },
          { title: `Decide: continue, pause or stop ${p.name}`, mode: "YOU", humanKind: "decision", tags: ["Decision"], after: [0] },
        ],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Briefings

export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${String(r).padStart(2, "0")}m`;
}

export function fmtClock(ts: number, tzOffsetMin: number): string {
  const d = new Date(ts - tzOffsetMin * MIN);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export interface Briefing {
  headline: string;
  you: Task[];
  ai: Task[];
  waiting: Task[];
  opportunities: Opportunity[];
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function morningBriefing(state: WorkspaceState, now: number): Briefing {
  const wf = workforce(state, now);
  const move = nextMove(state, now);
  const aiTasks = [...wf.ai.map((a) => a.task), ...wf.suggested];
  const opps = state.opportunities.filter((o) => o.status === "open");
  let headline = "Nothing needs you right now. The AI workforce is handling the rest.";
  if (move) {
    const when = move.scheduledAt ? ` at ${fmtClock(move.scheduledAt, state.settings.tzOffsetMin)}` : "";
    const verb = lowerFirst(move.title);
    const prep = state.tasks.find((t) => t.parentId === move.id);
    const running = wf.ai.filter((a) => a.job?.status === "RUNNING").length;
    const aiLine = prep && isOpen(prep)
      ? "Meanwhile, I’m preparing your brief"
      : prep
        ? "Your brief is ready"
        : aiTasks.length
          ? `Meanwhile, the AI is on ${aiTasks.length} task${aiTasks.length > 1 ? "s" : ""}${running ? `, ${running} running now` : ""}`
          : "Nothing else needs you";
    headline = `Your most valuable action today is to ${verb}${when}. ${aiLine}.`;
  }
  return { headline, you: wf.you.slice(0, 3), ai: aiTasks.slice(0, 6), waiting: wf.waiting, opportunities: opps.slice(0, 2) };
}

export interface DailyReport {
  youDid: Task[];
  aiDid: Task[];
  savedMinutes: number;
  stillImportant: Task[];
  tomorrow: Task | null;
  tomorrowPrep: string[];
}

export function dailyReport(state: WorkspaceState, now: number): DailyReport {
  const since = startOfToday(now, state.settings.tzOffsetMin);
  const doneToday = state.tasks.filter((t) => t.status === "done" && (t.completedAt ?? 0) >= since);
  const aiDid = doneToday.filter((t) => t.mode === "AI" || (t.parentId !== null && t.mode !== "YOU"));
  const youDid = doneToday.filter((t) => !aiDid.includes(t));
  const wf = workforce(state, now);
  const move = nextMove(state, now);
  return {
    youDid,
    aiDid,
    savedMinutes: timeSaved(state.jobs, since).minutes,
    stillImportant: wf.you.filter((t) => t.humanValue >= 4).slice(0, 3),
    tomorrow: move,
    tomorrowPrep: move?.aiPrep.slice(0, 3) ?? [],
  };
}

export function agentLoad(jobs: AgentJob[]) {
  return Object.values(AGENTS).map((a) => ({
    agent: a,
    running: jobs.find((j) => j.agent === a.role && j.status === "RUNNING") ?? null,
    queued: jobs.filter((j) => j.agent === a.role && j.status === "QUEUED").length,
  }));
}
