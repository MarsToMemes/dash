// MissionOptimizer — the intelligence layer.
//
// One question drives everything here: what combination of human actions and
// AI actions creates the most meaningful progress per hour of Rémi's attention?
//
// Pure functions over WorkspaceState, shared by the server (ranking, queue
// order, automatic effects) and the UI (plans, recommendations, metrics), so
// both always agree. Every score is explainable: functions return reasons,
// not just numbers.

import { AGENTS } from "./agents.ts";
import { delegationPhrase } from "./classifier.ts";
import {
  fmtDuration,
  isHumanAction,
  isOpen,
  isUnblocked,
  latestJob,
  localMinuteOfDay,
  projectProgress,
  startOfToday,
  startOfWeek,
  timeSaved,
} from "./planner.ts";
import type {
  AgentRole,
  Decision,
  HumanKind,
  Project,
  StrategyId,
  Task,
  TaskDraft,
  WorkspaceState,
} from "./types.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type State = Pick<WorkspaceState, "projects" | "tasks" | "jobs" | "settings" | "opportunities" | "decisions" | "activity">;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

function byIdMap(state: Pick<State, "tasks">) {
  return new Map(state.tasks.map((t) => [t.id, t]));
}

function projectOf(state: Pick<State, "projects">, t: Task): Project | null {
  return state.projects.find((p) => p.id === t.projectId) ?? null;
}

export function isParked(p: Project | null, now: number): boolean {
  return Boolean(p?.parkedUntil && p.parkedUntil > now);
}

export function activeDecisions(state: Pick<State, "decisions">, now: number): Decision[] {
  return state.decisions.filter((d) => !d.until || d.until > now);
}

/** Minutes Rémi personally has to put into a task. */
export function humanMinutesOf(t: Task): number {
  if (t.mode === "WAITING") return 0;
  if ((t.mode === "AI" || t.mode === "AI_YOU") && !t.keptHuman && t.status !== "your_turn" && t.status !== "awaiting_approval") {
    return t.mode === "AI" ? (t.risk === "low" ? 0 : 5) : t.humanMinutes || 15;
  }
  if (t.keptHuman) return t.humanMinutes || t.manualMinutes || 15;
  if (t.status === "awaiting_approval") return Math.max(2, Math.min(t.humanMinutes || 5, 15));
  return t.humanMinutes || 15;
}

/** Does Rémi have to act on this task (now or once unblocked)? */
export function needsHuman(t: Task): boolean {
  if (t.isMission || !isOpen(t)) return false;
  return t.mode === "YOU" || t.keptHuman || t.status === "your_turn" || t.status === "awaiting_approval";
}

// ---------------------------------------------------------------------------
// Value

/** 0–10: how much a project matters right now (direction, money, deadline). */
export function projectValue(p: Project, now: number): number {
  let v = p.strategicValue * 1.1 + p.revenuePotential * 0.9;
  if (p.deadline) {
    const d = p.deadline - now;
    if (d < 3 * DAY) v += 1.5;
    else if (d < 7 * DAY) v += 0.8;
  }
  if (isParked(p, now)) v *= 0.3;
  return round1(clamp(v, 0, 10));
}

const KIND_LEVERAGE: Record<HumanKind, number> = {
  call: 8.8,
  relationship: 9.0,
  meeting: 8.6,
  onsite: 8.0,
  signature: 8.0,
  decision: 7.6,
  creative: 8.4,
  review: 5.4,
  generic: 4.8,
};

const RELATIONSHIP_RE = /\b(client|prospect|partner|investor|lead|customer|deal)\b/i;

export interface Leverage {
  score: number;
  reasons: string[];
}

/** humanLeverageScore (0–10): how valuable it is for Rémi to personally spend time on this. */
export function humanLeverage(t: Task, p: Project | null): Leverage {
  if (t.mode === "WAITING" || t.status === "waiting") {
    return { score: 0.5, reasons: [`Blocked by ${t.waitingOn ?? "someone else"} — nothing for you to do yet`] };
  }
  const aiCapable = (t.mode === "AI" || (t.agent !== null && t.automation >= 75)) && t.humanKind !== "decision";
  if (aiCapable && t.status !== "awaiting_approval") {
    const s = 1 + ((100 - t.automation) / 25) * 0.5 + (t.risk === "low" ? 0 : 0.4);
    return {
      score: round1(s),
      reasons: [t.keptHuman ? `You kept it, but the ${AGENTS[t.agent ?? "operations"].name} can do it end to end` : `An agent can do this end to end`],
    };
  }
  if (t.status === "awaiting_approval") {
    return { score: round1(5 + (t.risk === "high" ? 2 : 1)), reasons: ["The AI did the work — only your approval is needed", "Quick, and it releases finished work"] };
  }
  const kind: HumanKind = t.humanKind ?? "generic";
  const creativeDecision = kind === "decision" && t.agent === "design";
  let s = creativeDecision ? 9.0 : KIND_LEVERAGE[kind];
  const reasons: string[] = [];
  reasons.push(
    {
      call: "Phone conversation",
      relationship: "Relationship and negotiation",
      meeting: "Live presence",
      onsite: "Physical presence",
      signature: "Legal signature",
      decision: creativeDecision ? "Final creative decision" : "Your judgment",
      creative: "Your creative work",
      review: "Your review",
      generic: "Needs you",
    }[kind],
  );
  if (RELATIONSHIP_RE.test(t.title)) {
    s += 0.6;
    reasons.push("Client relationship");
  }
  if (p) {
    s += (p.revenuePotential - 3) * 0.2 + (p.strategicValue - 3) * 0.15;
    if (p.revenuePotential >= 4) reasons.push(p.kind === "client" ? "Client project" : "Revenue potential");
  }
  s += (t.humanValue - 3) * 0.3;
  if (t.status === "your_turn") reasons.push("The AI already prepared everything");
  return { score: round1(clamp(s, 0, 9.9)), reasons };
}

/** Transitive open dependents — how much work this task holds up. */
export function downstream(t: Task, state: Pick<State, "tasks">): Task[] {
  const out = new Map<string, Task>();
  const walk = (id: string) => {
    for (const x of state.tasks) {
      if (x.dependsOn.includes(id) && isOpen(x) && !out.has(x.id)) {
        out.set(x.id, x);
        walk(x.id);
      }
    }
  };
  walk(t.id);
  return [...out.values()];
}

/** 0–10: the meaningful progress completing this task creates. */
export function taskImpact(t: Task, state: State, now: number): number {
  const p = projectOf(state, t);
  const pv = p ? projectValue(p, now) : 4;
  const prio = { critical: 3, high: 2, medium: 1, low: 0 }[t.priority];
  const unblocks = Math.min(3, downstream(t, state).length) * 0.8;
  const progress = p ? projectProgress(p, state.tasks) : 0;
  const finishing = progress >= 0.75 ? 1.5 * Math.min(1, (progress - 0.75) / 0.2) : 0;
  const focus = state.settings.focus && p && state.settings.focus.projectId === p.id && state.settings.focus.until > now ? 2 : 0;
  let impact = pv * 0.55 + prio + unblocks + finishing + focus;
  if (isParked(p, now)) impact *= 0.3;
  return round1(clamp(impact, 0, 10));
}

/** timeValueScore: progress created per hour of Rémi's time (impact × leverage / hours). */
export function timeValue(t: Task, state: State, now: number): number {
  const p = projectOf(state, t);
  const hours = Math.max(5, humanMinutesOf(t)) / 60;
  return round1((taskImpact(t, state, now) * humanLeverage(t, p).score) / 10 / hours);
}

// ---------------------------------------------------------------------------
// Context (energy, place, focus, maximum leverage)

const ON_THE_GO: HumanKind[] = ["call", "review", "decision", "relationship"];
const OUT: HumanKind[] = ["onsite", "meeting", "call", "relationship"];

export function contextFit(t: Task, state: State): { factor: number; note: string | null } {
  const kind = t.humanKind ?? "generic";
  const mins = humanMinutesOf(t);
  let factor = 1;
  let note: string | null = null;
  if (state.settings.energy === "low") {
    if (mins > 45 || kind === "creative") {
      factor *= 0.6;
      note = "Heavy for a low-energy moment";
    } else if (kind === "review" || t.status === "awaiting_approval" || mins <= 15) factor *= 1.2;
  } else if (state.settings.energy === "high" && (kind === "creative" || (kind === "decision" && t.agent === "design"))) {
    factor *= 1.2;
  }
  if (state.settings.place === "on_the_go" && !ON_THE_GO.includes(kind) && t.status !== "awaiting_approval") {
    factor *= 0.3;
    note = "Needs your desk";
  }
  if (state.settings.place === "out" && !OUT.includes(kind)) {
    factor *= 0.4;
    note = "Not doable while out";
  }
  if (kind === "onsite" && state.settings.place === "desk" && !t.scheduledAt) factor *= 0.8;
  return { factor, note };
}

/** Human tasks pushed aside while focusing on one project. */
export function suppressedByFocus(t: Task, state: State, now: number): boolean {
  const f = state.settings.focus;
  if (!f || f.until <= now) return false;
  if (t.projectId === f.projectId) return false;
  if (t.scheduledAt && t.scheduledAt - now < 90 * MIN && t.scheduledAt > now - HOUR) return false; // commitments stay
  return humanLeverage(t, projectOf(state, t)).score < 8.5;
}

/** Human tasks hidden by Maximum Leverage mode (anything the AI could take or that barely needs you). */
export function suppressedByLeverage(t: Task, state: State): boolean {
  if (!state.settings.maxLeverage) return false;
  if (t.status === "awaiting_approval") return false;
  return humanLeverage(t, projectOf(state, t)).score < 6;
}

// ---------------------------------------------------------------------------
// Ranking — used by the engine for "What should I do?"

export function humanRankScore(t: Task, state: State, now: number): number {
  let s = timeValue(t, state, now) * 4 + humanLeverage(t, projectOf(state, t)).score * 6 + taskImpact(t, state, now) * 3;
  if (t.scheduledAt) {
    const delta = t.scheduledAt - now;
    if (delta < -15 * MIN) s += 8;
    else if (delta <= 45 * MIN) s += 40;
    else if (delta <= 3 * HOUR) s += 10;
    else s -= 25; // later — don't start it now
  }
  if (t.status === "your_turn") s += 12;
  if (t.status === "awaiting_approval") s += 10;
  s *= Math.pow(0.85, t.postponedCount); // each "Not now" counts
  s *= contextFit(t, state).factor;
  if (suppressedByFocus(t, state, now)) s *= 0.35;
  if (suppressedByLeverage(t, state)) s *= 0.3;
  if (isParked(projectOf(state, t), now)) s *= 0.2;
  return s;
}

export interface AiPriority {
  score: number;
  reason: string;
}

/** AI WORK QUEUE OPTIMIZATION: what the workforce should pick up first. */
export function aiPriority(t: Task, state: State, now: number): AiPriority {
  const byId = byIdMap(state);
  let score = taskImpact(t, state, now) * 2 + t.manualMinutes / 6;
  let reason = `Saves you ~${fmtDuration(t.manualMinutes)}`;
  const blockedHumans = downstream(t, state).filter((d) => needsHuman(d) || d.mode === "YOU");
  const parent = t.parentId ? byId.get(t.parentId) : undefined;
  if (parent && !parent.isMission && isOpen(parent)) {
    score += 25;
    reason = `Prepares “${parent.title}”`;
    if (parent.scheduledAt && parent.scheduledAt - now < 2 * HOUR) {
      score += 15;
      reason = `Prepares “${parent.title}” — coming up soon`;
    }
  }
  if (blockedHumans.length) {
    score += 30;
    reason = `Unblocks your “${blockedHumans[0].title}”`;
  }
  score += Math.min(4, downstream(t, state).length) * 4;
  const p = projectOf(state, t);
  if (p?.deadline && p.deadline - now < 3 * DAY) {
    score += 8;
    if (!blockedHumans.length && !parent) reason = `${p.name} deadline in ${Math.max(1, Math.round((p.deadline - now) / DAY))}d`;
  }
  if (state.settings.focus && p?.id === state.settings.focus.projectId && state.settings.focus.until > now) score += 12;
  if (isParked(p, now)) score -= 20;
  return { score: round1(score), reason };
}

/** Full re-ranking: human actions by attention value, then AI work by queue priority. */
export function rankAll(state: State, now: number): Map<string, number> {
  const byId = byIdMap(state);
  const open = state.tasks.filter(isOpen);
  const human = open.filter((t) => isHumanAction(t, byId)).sort((a, b) => humanRankScore(b, state, now) - humanRankScore(a, state, now));
  const rest = open.filter((t) => !isHumanAction(t, byId)).sort((a, b) => aiPriority(b, state, now).score - aiPriority(a, state, now).score);
  const ranks = new Map<string, number>();
  [...human, ...rest].forEach((t, i) => ranks.set(t.id, i));
  return ranks;
}

// ---------------------------------------------------------------------------
// Momentum

export type MomentumLabel = "accelerating" | "steady" | "slowing" | "stalled" | "parked" | "done";

export interface Momentum {
  score: number;
  label: MomentumLabel;
  reasons: string[];
  daysIdle: number;
  recentDone: number;
  open: number;
  blocked: number;
  humanMinutesLeft: number;
  aiMinutesLeft: number;
  progress: number;
}

/** projectMomentumScore (0–100): is this project moving, and how fast? */
export function projectMomentum(p: Project, state: State, now: number): Momentum {
  const mine = state.tasks.filter((t) => t.projectId === p.id && !t.isMission);
  const open = mine.filter(isOpen);
  const byId = byIdMap(state);
  const daysIdle = Math.max(0, (now - p.lastActivityAt) / DAY);
  const recentDone = mine.filter((t) => t.status === "done" && (t.completedAt ?? 0) > now - 7 * DAY).length;
  const activeAi = state.jobs.some((j) => (j.status === "RUNNING" || j.status === "QUEUED") && byId.get(j.task_id)?.projectId === p.id);
  const aiAvailable = open.some((t) => (t.mode === "AI" || t.mode === "AI_YOU") && t.status === "todo");
  const blocked = open.filter((t) => t.status === "waiting" || !isUnblocked(t, byId)).length;
  const progress = projectProgress(p, state.tasks);

  const recency = Math.max(0, 1 - daysIdle / 7);
  const throughput = Math.min(1, recentDone / 6);
  const ai = activeAi ? 1 : aiAvailable ? 0.5 : 0;
  const unblocked = open.length ? 1 - blocked / open.length : 1;
  const milestone = p.goal ? 1 : 0;
  const score = Math.round(recency * 30 + throughput * 25 + ai * 10 + progress * 15 + unblocked * 10 + milestone * 10);

  const reasons: string[] = [];
  if (daysIdle >= 3) reasons.push(`No activity for ${Math.floor(daysIdle)} days`);
  else if (recentDone >= 3) reasons.push(`${recentDone} tasks done this week`);
  if (activeAi) reasons.push("AI is working on it");
  if (blocked) reasons.push(`${blocked} blocked`);
  if (!p.goal) reasons.push("No defined milestone");

  const label: MomentumLabel = isParked(p, now) ? "parked" : open.length === 0 ? "done" : score >= 70 ? "accelerating" : score >= 45 ? "steady" : score >= 25 ? "slowing" : "stalled";
  return {
    score,
    label,
    reasons,
    daysIdle,
    recentDone,
    open: open.length,
    blocked,
    humanMinutesLeft: open.filter((t) => t.mode === "YOU" || t.mode === "AI_YOU" || t.keptHuman).reduce((s, t) => s + humanMinutesOf(t), 0),
    aiMinutesLeft: open.filter((t) => (t.mode === "AI" || t.mode === "AI_YOU") && !t.keptHuman && t.status !== "your_turn").reduce((s, t) => s + t.aiMinutes, 0),
    progress,
  };
}

/** Projects that still compete for attention. */
export function activeProjects(state: State, now: number): Project[] {
  return state.projects.filter((p) => !isParked(p, now) && state.tasks.some((t) => t.projectId === p.id && isOpen(t) && !t.isMission));
}

// ---------------------------------------------------------------------------
// FINISH WHAT MATTERS + PROJECT FOCUS

export interface FinishCandidate {
  project: Project;
  progress: number;
  humanMinutes: number;
  aiMinutes: number;
  message: string;
}

export function finishWhatMatters(state: State, now: number): FinishCandidate[] {
  return activeProjects(state, now)
    .map((p) => ({ p, m: projectMomentum(p, state, now) }))
    .filter(({ p, m }) => m.progress >= 0.75 && projectValue(p, now) >= 6 && m.label !== "stalled" && m.blocked < m.open)
    .map(({ p, m }) => ({
      project: p,
      progress: m.progress,
      humanMinutes: m.humanMinutesLeft,
      aiMinutes: m.aiMinutesLeft,
      message: `${p.name} is ${Math.round(m.progress * 100)}% complete. About ${fmtDuration(m.humanMinutesLeft)} of your time stands between you and ${
        p.goal ? `“${p.goal}”` : "a finished project"
      }.`,
    }))
    .sort((a, b) => projectValue(b.project, now) * b.progress - projectValue(a.project, now) * a.progress);
}

export interface FocusPlan {
  project: Project;
  goal: string | null;
  human: Task[];
  ai: Task[];
  blocked: Task[];
  humanMinutes: number;
  aiMinutes: number;
  /** AI time when agents run in parallel (longest agent lane). */
  aiWallMinutes: number;
  timeToMilestone: number;
}

/** Shortest path to meaningful completion for one project. */
export function focusPlan(state: State, projectId: string, now: number): FocusPlan | null {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const byId = byIdMap(state);
  const open = state.tasks.filter((t) => t.projectId === projectId && isOpen(t) && !t.isMission);
  const blocked = open.filter((t) => t.status === "waiting" || t.mode === "WAITING");
  const human = open
    .filter((t) => needsHuman(t) && !blocked.includes(t))
    .sort((a, b) => Number(isUnblocked(b, byId)) - Number(isUnblocked(a, byId)) || humanRankScore(b, state, now) - humanRankScore(a, state, now));
  const ai = open
    .filter((t) => !needsHuman(t) && !blocked.includes(t) && t.agent)
    .sort((a, b) => aiPriority(b, state, now).score - aiPriority(a, state, now).score);
  const humanMinutes = human.reduce((s, t) => s + humanMinutesOf(t), 0);
  const lanes = new Map<AgentRole, number>();
  for (const t of ai) lanes.set(t.agent!, (lanes.get(t.agent!) ?? 0) + t.aiMinutes);
  const aiWallMinutes = Math.max(0, ...lanes.values());
  return {
    project,
    goal: project.goal,
    human,
    ai,
    blocked,
    humanMinutes,
    aiMinutes: ai.reduce((s, t) => s + t.aiMinutes, 0),
    aiWallMinutes,
    timeToMilestone: Math.max(humanMinutes, aiWallMinutes),
  };
}

// ---------------------------------------------------------------------------
// DEAD PROJECTS, OVERLOAD, TRADE-OFFS, PROCRASTINATION

export interface DeadProject {
  project: Project;
  daysIdle: number;
  open: number;
  signals: string[];
  recommendation: "park" | "revive";
}

export function deadProjects(state: State, now: number): DeadProject[] {
  const out: DeadProject[] = [];
  for (const p of state.projects) {
    if (isParked(p, now)) continue;
    const mine = state.tasks.filter((t) => t.projectId === p.id && !t.isMission);
    const open = mine.filter(isOpen);
    if (open.length === 0) continue;
    const m = projectMomentum(p, state, now);
    const postponements = open.reduce((s, t) => s + t.postponedCount, 0);
    const humanRecently = mine.some((t) => t.status === "done" && t.mode === "YOU" && (t.completedAt ?? 0) > now - 7 * DAY);
    const aiRecently = state.jobs.some((j) => mine.some((t) => t.id === j.task_id) && (j.status === "RUNNING" || (j.completed_at ?? 0) > now - 7 * DAY));
    const signals: string[] = [];
    if (m.daysIdle >= 5) signals.push(`No meaningful activity: ${Math.floor(m.daysIdle)} days`);
    if (postponements >= 3) signals.push(`Postponed ${postponements} times`);
    if (open.length >= 8) signals.push(`${open.length} unfinished missions`);
    if (!p.goal) signals.push("Next milestone: undefined");
    if (!humanRecently) signals.push("No human action this week");
    if (!aiRecently) signals.push("No AI activity this week");
    if (m.daysIdle >= 5 && signals.length >= 3) {
      out.push({ project: p, daysIdle: m.daysIdle, open: open.length, signals, recommendation: projectValue(p, now) >= 6 ? "revive" : "park" });
    }
  }
  return out;
}

export interface Triage {
  overloaded: boolean;
  primary: { project: Project; reason: string }[];
  secondary: { project: Project; reason: string }[];
  park: { project: Project; reason: string }[];
}

export function portfolioTriage(state: State, now: number): Triage {
  const active = activeProjects(state, now);
  const rows = active
    .map((p) => {
      const m = projectMomentum(p, state, now);
      const v = projectValue(p, now);
      const focus = state.settings.focus?.projectId === p.id && state.settings.focus.until > now ? 3 : 0;
      return { p, m, v, score: v * 0.5 + (m.score / 10) * 0.3 + m.progress * 10 * 0.2 + focus };
    })
    .sort((a, b) => b.score - a.score);
  // Projects that are losing momentum never compete for primary attention.
  const dead = new Set(deadProjects(state, now).map((d) => d.project.id));
  const alive = rows.filter((r) => !dead.has(r.p.id));
  const dying = rows.filter((r) => dead.has(r.p.id));
  const topMomentum = Math.max(0, ...rows.map((r) => r.m.score));
  const why = (r: (typeof rows)[number], tier: "primary" | "secondary" | "park") => {
    if (tier === "park") {
      if (r.m.label === "stalled" || r.m.daysIdle >= 5) return `No activity for ${Math.floor(r.m.daysIdle)} days and ${r.v < 6 ? "low strategic value" : "no clear next step"}.`;
      return `Needs ~${fmtDuration(r.m.humanMinutesLeft)} of your time for ${r.v < 6 ? "low" : "moderate"} strategic value right now.`;
    }
    if (state.settings.focus?.projectId === r.p.id) return "Your current focus.";
    if (r.p.stage === "deployed" || r.p.stage === "shipped") return "Already live — the AI can carry most of what’s left.";
    if (r.m.progress >= 0.75) return `Closest to a finished ${r.p.kind === "client" ? "portfolio asset" : "release"} (${Math.round(r.m.progress * 100)}%).`;
    if (r.m.score === topMomentum) return `Highest momentum (${r.m.score}/100).`;
    if (r.p.revenuePotential >= 4) return "Highest revenue potential.";
    return tier === "primary" ? "Highest strategic value." : "Worth keeping warm — the AI can carry most of it.";
  };
  return {
    overloaded: active.length > 3,
    primary: alive.slice(0, 2).map((r) => ({ project: r.p, reason: why(r, "primary") })),
    secondary: alive.slice(2, 3).map((r) => ({ project: r.p, reason: why(r, "secondary") })),
    park: [...alive.slice(3), ...dying].map((r) => ({ project: r.p, reason: why(r, "park") })),
  };
}

export interface TradeOff {
  a: Project;
  b: Project;
  points: Record<string, string[]>;
  winner: Project;
  loser: Project;
  reason: string;
  days: number;
}

export function strategicTradeOff(state: State, now: number): TradeOff | null {
  const t = portfolioTriage(state, now);
  if (t.primary.length < 2) return null;
  const [a, b] = t.primary.map((x) => x.project);
  const decided = activeDecisions(state, now).some(
    (d) => (d.kind === "tradeoff" || d.kind === "focus") && (d.projectId === a.id || d.projectId === b.id),
  );
  if (decided) return null;
  const describe = (p: Project) => {
    const m = projectMomentum(p, state, now);
    const pts: string[] = [];
    pts.push(m.progress >= 0.75 ? `Close to completion (${Math.round(m.progress * 100)}%)` : `${Math.round(m.progress * 100)}% complete — more development required`);
    if (p.strategicValue >= 4) pts.push(p.kind === "client" ? "High portfolio value" : "Strong long-term value");
    if (p.revenuePotential >= 4) pts.push(p.kind === "client" ? "High commercial potential" : "Revenue upside");
    pts.push(`~${fmtDuration(m.humanMinutesLeft)} of your time left`);
    if (p.kind === "product") pts.push("Higher uncertainty");
    return { pts, m, effort: m.humanMinutesLeft / 60 + 1 };
  };
  const da = describe(a);
  const db = describe(b);
  const value = (p: Project, d: ReturnType<typeof describe>) => (projectValue(p, now) * (1 + d.m.progress)) / Math.sqrt(d.effort);
  const aWins = value(a, da) >= value(b, db);
  const winner = aWins ? a : b;
  const wd = aWins ? da : db;
  const reason =
    wd.m.progress >= 0.75
      ? `Lower effort → faster completion → ${winner.kind === "client" ? "immediate portfolio asset → potential client acquisition" : "a shippable release"}.`
      : `Better value per hour of your time right now (${projectValue(winner, now)}/10 value, ~${fmtDuration(wd.m.humanMinutesLeft)} left).`;
  return {
    a,
    b,
    points: { [a.id]: da.pts, [b.id]: db.pts },
    winner,
    loser: aWins ? b : a,
    reason,
    days: wd.m.humanMinutesLeft > 6 * 60 ? 5 : 2,
  };
}

export interface Procrastination {
  task: Task;
  count: number;
  diagnosis: string;
  suggestions: ("break_down" | "delegate" | "delete")[];
}

export function procrastination(state: State, now: number): Procrastination[] {
  const byId = byIdMap(state);
  return state.tasks
    .filter((t) => isOpen(t) && t.postponedCount >= 3)
    .map((t) => {
      const p = projectOf(state, t);
      let diagnosis = "Unclear first step — it feels bigger than it is.";
      if (!isUnblocked(t, byId)) diagnosis = "It’s blocked — you can’t move it anyway.";
      else if (t.humanKind === "generic" && /can.t tell/i.test(t.reason)) diagnosis = "Too vague — there is no concrete first action.";
      else if (humanMinutesOf(t) >= 90) diagnosis = "Too large to start in one sitting.";
      else if (t.agent && t.automation >= 50) diagnosis = "An agent could do most of it — that’s why it never feels urgent.";
      else if (t.priority === "low" || isParked(p, now)) diagnosis = "Probably not actually important.";
      const suggestions: Procrastination["suggestions"] = ["break_down"];
      if (t.agent || t.aiPrep.length) suggestions.push("delegate");
      if (t.priority !== "critical") suggestions.push("delete");
      return { task: t, count: t.postponedCount, diagnosis, suggestions };
    })
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// HUMAN UNBLOCK ENGINE + DON'T DO THIS

export interface UnblockAction {
  human: Task;
  blocker: Task | null;
  kind: "run" | "prep" | "follow_up";
  message: string;
}

/** What the AI can do right now so Rémi can do something important afterwards. */
export function unblockActions(state: State, now: number): UnblockAction[] {
  const byId = byIdMap(state);
  const out: UnblockAction[] = [];
  for (const h of state.tasks) {
    if (!isOpen(h) || h.isMission || !(h.mode === "YOU" || h.mode === "AI_YOU" || h.keptHuman)) continue;
    const hp = projectOf(state, h);
    if (isParked(hp, now) || (hp && projectValue(hp, now) < 5)) continue;
    for (const depId of h.dependsOn) {
      const d = byId.get(depId);
      if (!d || !isOpen(d)) continue;
      if (d.status === "todo" && (d.mode === "AI" || d.mode === "AI_YOU") && d.agent && !d.keptHuman) {
        out.push({ human: h, blocker: d, kind: "run", message: `Run “${d.title}” so you can ${h.title.charAt(0).toLowerCase() + h.title.slice(1)}.` });
      } else if (d.status === "waiting") {
        out.push({ human: h, blocker: d, kind: "follow_up", message: `“${h.title}” waits on ${d.waitingOn ?? "someone"} — I’ll draft a follow-up.` });
      }
    }
    const hasPrep = state.tasks.some((c) => c.parentId === h.id);
    if (h.mode === "YOU" && h.aiPrep.length && !hasPrep && h.agent && isUnblocked(h, byId) && (!h.scheduledAt || h.scheduledAt - now < 6 * HOUR)) {
      out.push({ human: h, blocker: null, kind: "prep", message: `Let me prepare ${h.aiPrep.slice(0, 2).join(" and ").toLowerCase()} for “${h.title}”.` });
    }
  }
  return out.slice(0, 6);
}

export interface DontDo {
  task: Task;
  reason: string;
}

export function dontDoThis(state: State, now: number, move: Task | null): DontDo[] {
  const out: DontDo[] = [];
  const target = move ? `“${move.title}”` : "higher-leverage work";
  for (const t of state.tasks) {
    if (!isOpen(t) || t.isMission) continue;
    if (t.keptHuman && t.agent && t.automation >= 50) {
      out.push({ task: t, reason: `The ${AGENTS[t.agent].name} can complete it autonomously. Your attention is worth more on ${target}.` });
    }
  }
  const f = state.settings.focus;
  if (f && f.until > now) {
    const others = state.tasks.filter((t) => isOpen(t) && needsHuman(t) && t.projectId && t.projectId !== f.projectId && suppressedByFocus(t, state, now));
    if (others.length) {
      const p = state.projects.find((x) => x.id === others[0].projectId);
      out.push({ task: others[0], reason: `You decided to focus on ${state.projects.find((x) => x.id === f.projectId)?.name}. ${p?.name ?? "This"} can wait.` });
    }
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// DAILY DECISION ENGINE

export interface DecisionNow {
  move: Task | null;
  leverage: Leverage | null;
  why: string;
  meanwhile: { task: Task; agent: AgentRole; minutes: number; running: boolean } | null;
  after: Task | null;
  dontDo: DontDo | null;
}

export function decideNow(state: State, now: number): DecisionNow {
  const byId = byIdMap(state);
  const human = state.tasks
    .filter((t) => isOpen(t) && isHumanAction(t, byId))
    .sort((a, b) => a.rank - b.rank || humanRankScore(b, state, now) - humanRankScore(a, state, now));
  const move = human[0] ?? null;
  const leverage = move ? humanLeverage(move, projectOf(state, move)) : null;
  let why = "Nothing needs you right now.";
  if (move && leverage) {
    const top = human.every((h) => humanLeverage(h, projectOf(state, h)).score <= leverage.score + 0.05);
    const timing = move.scheduledAt && move.scheduledAt - now < 45 * MIN && move.scheduledAt > now - HOUR ? " and it’s coming up now" : "";
    why = `${top ? "The highest human-leverage action available" : "The best use of your next minutes"} (${leverage.score}/10)${timing}. ${leverage.reasons.slice(0, 2).join(" · ")}.`;
  }
  // MEANWHILE: what the AI does in parallel — prep for the move first, else its top priority.
  let meanwhile: DecisionNow["meanwhile"] = null;
  const prep = move ? state.tasks.find((t) => t.parentId === move.id && isOpen(t) && t.agent) : undefined;
  const pick =
    prep ??
    state.tasks
      .filter((t) => isOpen(t) && !needsHuman(t) && t.agent && (t.status === "ai_running" || t.status === "ai_queued" || (t.status === "todo" && isUnblocked(t, byId))))
      .sort((a, b) => aiPriority(b, state, now).score - aiPriority(a, state, now).score)[0];
  if (pick?.agent) meanwhile = { task: pick, agent: pick.agent, minutes: pick.aiMinutes, running: pick.status === "ai_running" };
  return { move, leverage, why, meanwhile, after: human[1] ?? null, dontDo: dontDoThis(state, now, move)[0] ?? null };
}

// ---------------------------------------------------------------------------
// TIME ARBITRAGE + PARALLEL EXECUTION

export interface HumanBlock {
  task: Task;
  minutes: number;
  start: number;
  end: number;
  leverage: number;
  impact: number;
  why: string;
}

export interface AiBlock {
  task: Task | null;
  /** Work that would come from an AI-generated mission not yet accepted. */
  draft: { title: string; opportunityId: string } | null;
  agent: AgentRole;
  minutes: number;
  start: number;
  end: number;
  why: string;
}

const STRATEGY_WEIGHT: Record<StrategyId, (t: Task, p: Project | null, progress: number) => number> = {
  finish: (_t, p, progress) => (p && progress >= 0.7 && p.strategicValue * 1.1 + p.revenuePotential * 0.9 >= 5 ? 2.4 : 0.5),
  build: (t, p) => (p && p.kind !== "client" ? 2 : 0.7) * (t.humanKind === "creative" || t.humanKind === "decision" || t.humanKind === "review" ? 1.3 : 1),
  revenue: (t, p) =>
    t.humanKind === "call" || t.humanKind === "meeting" || t.humanKind === "relationship" || /client|prospect|outreach|case study|portfolio|pitch/i.test(t.title)
      ? 2.6
      : p && p.kind === "client" && p.revenuePotential >= 4
        ? 1.2
        : 0.5,
  balanced: () => 1,
};

function humanCandidates(state: State, now: number, windowEnd: number): Task[] {
  const byId = byIdMap(state);
  return state.tasks.filter(
    (t) =>
      isOpen(t) &&
      isHumanAction(t, byId) &&
      !isParked(projectOf(state, t), now) &&
      !(t.scheduledAt && (t.scheduledAt >= windowEnd || t.scheduledAt + humanMinutesOf(t) * MIN <= now)),
  );
}

export interface ArbitragePlan {
  minutes: number;
  human: HumanBlock[];
  usedMinutes: number;
  ai: AiBlock[];
  delegateInstead: { task: Task; saved: number; instead: Task | null }[];
  skipped: { task: Task; why: string }[];
}

/** TimeArbitrageEngine: the best use of N minutes, with the AI working in parallel. */
export function timeArbitrage(state: State, minutes: number, now: number, strategy: StrategyId = "balanced"): ArbitragePlan {
  const start = Math.ceil(now / (5 * MIN)) * 5 * MIN;
  const end = start + minutes * MIN;
  const progressOf = new Map(state.projects.map((p) => [p.id, projectProgress(p, state.tasks)]));
  const scored = humanCandidates(state, now, end).map((t) => {
    const p = projectOf(state, t);
    const lev = humanLeverage(t, p);
    const fit = contextFit(t, state);
    const w = STRATEGY_WEIGHT[strategy](t, p, p ? progressOf.get(p.id) ?? 0 : 0);
    return { t, lev, fit, impact: taskImpact(t, state, now), value: timeValue(t, state, now) * w * fit.factor };
  });
  const skipped: ArbitragePlan["skipped"] = [];
  const delegateInstead: ArbitragePlan["delegateInstead"] = [];
  const eligible = scored.filter((s) => {
    if (s.t.keptHuman && s.t.agent && s.lev.score < 4) {
      delegateInstead.push({ task: s.t, saved: humanMinutesOf(s.t), instead: null });
      return false;
    }
    if (suppressedByLeverage(s.t, state)) {
      skipped.push({ task: s.t, why: "Low leverage — hidden by Maximum Leverage" });
      return false;
    }
    if (suppressedByFocus(s.t, state, now)) {
      skipped.push({ task: s.t, why: "Outside your focus project" });
      return false;
    }
    if (s.fit.factor < 0.5) {
      skipped.push({ task: s.t, why: s.fit.note ?? "Doesn’t fit your context" });
      return false;
    }
    return true;
  });

  // Fixed commitments first, then the best value per minute that still fits.
  const human: HumanBlock[] = [];
  const fixed = eligible.filter((s) => s.t.scheduledAt).sort((a, b) => a.t.scheduledAt! - b.t.scheduledAt!);
  for (const s of fixed) {
    const mins = humanMinutesOf(s.t);
    const st = Math.max(start, s.t.scheduledAt!);
    human.push({ task: s.t, minutes: mins, start: st, end: st + mins * MIN, leverage: s.lev.score, impact: s.impact, why: "Scheduled commitment" });
  }
  // A strategy is a choice: apart from balanced, only work that serves its goal is planned.
  const serves = (s: (typeof eligible)[number]) => {
    if (strategy === "balanced") return true;
    const p = projectOf(state, s.t);
    return STRATEGY_WEIGHT[strategy](s.t, p, p ? progressOf.get(p.id) ?? 0 : 0) >= 1;
  };
  for (const s of eligible) if (!s.t.scheduledAt && !serves(s)) skipped.push({ task: s.t, why: `Not part of the ${strategy} strategy` });
  const flexible = eligible.filter((s) => !s.t.scheduledAt && serves(s)).sort((a, b) => b.value - a.value);
  let cursor = start;
  for (const s of flexible) {
    const mins = humanMinutesOf(s.t);
    for (;;) {
      const clash = human.find((b) => b.start < cursor + mins * MIN && b.end > cursor);
      if (!clash) break;
      cursor = clash.end;
    }
    if (cursor + mins * MIN > end) {
      skipped.push({ task: s.t, why: `Doesn’t fit (${fmtDuration(mins)})` });
      continue;
    }
    human.push({
      task: s.t,
      minutes: mins,
      start: cursor,
      end: cursor + mins * MIN,
      leverage: s.lev.score,
      impact: s.impact,
      why: s.t.status === "awaiting_approval" ? "Releases finished AI work" : `${s.lev.reasons[0]} · ${s.lev.score}/10 leverage`,
    });
    cursor += mins * MIN;
  }
  human.sort((a, b) => a.start - b.start);
  const top = human.find((h) => h.leverage >= 7) ?? null;
  for (const d of delegateInstead) d.instead = top?.task ?? null;

  const ai = parallelExecutionPlanner(state, human, start, end, now, strategy);
  return { minutes, human, usedMinutes: human.reduce((s, h) => s + h.minutes, 0), ai, delegateInstead, skipped };
}

/**
 * parallelExecutionPlanner: fill every idle agent lane while Rémi works.
 * Prep and unblockers go first; work that depends on a human block starts after it.
 */
export function parallelExecutionPlanner(
  state: State,
  human: HumanBlock[],
  start: number,
  end: number,
  now: number,
  strategy: StrategyId = "balanced",
  includeDrafts = true,
): AiBlock[] {
  const byId = byIdMap(state);
  const lanes = new Map<AgentRole, number>();
  // Running jobs keep their lane until they finish.
  for (const j of state.jobs) {
    if (j.status !== "RUNNING") continue;
    const t = byId.get(j.task_id);
    if (!t) continue;
    const eta = (j.started_at ?? now) + t.aiMinutes * MIN * (1 - Math.min(1, j.progress)) + 0;
    lanes.set(j.agent, Math.max(lanes.get(j.agent) ?? start, Math.max(start, eta)));
  }
  const out: AiBlock[] = [];
  for (const j of state.jobs) {
    if (j.status !== "RUNNING") continue;
    const t = byId.get(j.task_id);
    if (t) out.push({ task: t, draft: null, agent: j.agent, minutes: t.aiMinutes, start, end: lanes.get(j.agent) ?? start, why: "Already running" });
  }
  const progressOf = new Map(state.projects.map((p) => [p.id, projectProgress(p, state.tasks)]));
  const weight = (t: Task) => {
    const p = projectOf(state, t);
    return STRATEGY_WEIGHT[strategy]({ ...t, humanKind: null }, p, p ? progressOf.get(p.id) ?? 0 : 0);
  };
  const humanEnd = new Map(human.map((h) => [h.task.id, h.end]));
  const candidates = state.tasks
    .filter(
      (t) =>
        isOpen(t) &&
        !t.isMission &&
        t.agent &&
        !t.keptHuman &&
        (t.status === "todo" || t.status === "ai_queued") &&
        (t.mode === "AI" || t.mode === "AI_YOU") &&
        t.risk !== "high" &&
        !isParked(projectOf(state, t), now) &&
        t.dependsOn.every((d) => {
          const dep = byId.get(d);
          return !dep || dep.status === "done" || dep.status === "cancelled" || humanEnd.has(d) || dep.status === "ai_running";
        }),
    )
    .filter((t) => strategy === "balanced" || weight(t) >= 1 || t.parentId !== null || humanEnd.size === 0)
    .map((t) => ({ t, pr: aiPriority(t, state, now) }))
    .sort((a, b) => b.pr.score * weight(b.t) - a.pr.score * weight(a.t));
  for (const { t, pr } of candidates) {
    const agent = t.agent!;
    const afterHuman = Math.max(start, ...t.dependsOn.map((d) => humanEnd.get(d) ?? start));
    const s = Math.max(lanes.get(agent) ?? start, afterHuman);
    if (s >= end) continue;
    const e = s + Math.max(1, t.aiMinutes) * MIN;
    lanes.set(agent, e);
    out.push({ task: t, draft: null, agent, minutes: t.aiMinutes, start: s, end: e, why: afterHuman > start ? "Starts after your step (human → AI)" : pr.reason });
  }
  if (includeDrafts && (strategy === "revenue" || strategy === "finish" || strategy === "balanced")) {
    for (const o of state.opportunities.filter((x) => x.status === "open")) {
      const relevant = strategy === "revenue" ? /case study|outreach|prospect|portfolio/i.test(o.title + o.summary) : strategy === "finish" ? /case study|post-launch|live/i.test(o.title) : true;
      if (!relevant) continue;
      for (const d of o.drafts) {
        if (d.mode === "YOU" || !d.agent) continue;
        const s = lanes.get(d.agent) ?? start;
        if (s >= end) continue;
        const mins = AGENTS[d.agent].aiMinutes;
        lanes.set(d.agent, s + mins * MIN);
        out.push({ task: null, draft: { title: d.title, opportunityId: o.id }, agent: d.agent, minutes: mins, start: s, end: s + mins * MIN, why: `AI-generated: ${o.title}` });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// SIMULATE MY DAY

export interface StrategyPlan {
  id: StrategyId;
  label: string;
  goal: string;
  plan: ArbitragePlan;
  humanMinutes: number;
  aiMinutes: number;
  projects: { project: Project; delta: number }[];
  impact: "LOW" | "MEDIUM" | "HIGH";
  score: number;
}

export interface DaySimulation {
  minutes: number;
  strategies: StrategyPlan[];
  recommended: StrategyId;
  reason: string;
}

const STRATEGY_META: Record<StrategyId, { label: string; goal: string }> = {
  finish: { label: "Finish", goal: "Finish existing projects" },
  build: { label: "Build", goal: "Build the product" },
  revenue: { label: "Revenue", goal: "Generate opportunities and clients" },
  balanced: { label: "Balanced", goal: "Mix progress, revenue and maintenance" },
};

export function simulateDay(state: State, minutes: number, now: number): DaySimulation {
  const ids: StrategyId[] = ["finish", "build", "revenue", "balanced"];
  const strategies = ids.map((id) => {
    const plan = timeArbitrage(state, minutes, now, id);
    const done = new Set([...plan.human.map((h) => h.task.id), ...plan.ai.filter((a) => a.task && a.end <= now + minutes * MIN + 30 * MIN).map((a) => a.task!.id)]);
    const projects = state.projects
      .map((p) => {
        const mine = state.tasks.filter((t) => t.projectId === p.id && !t.isMission && t.status !== "cancelled");
        const total = mine.length + p.legacyDone;
        const gained = mine.filter((t) => done.has(t.id)).length;
        return { project: p, delta: total ? gained / total : 0 };
      })
      .filter((x) => x.delta > 0)
      .sort((a, b) => b.delta - a.delta);
    const impactSum =
      plan.human.reduce((s, h) => s + h.impact * (h.leverage / 10), 0) + plan.ai.reduce((s, a) => s + (a.task ? taskImpact(a.task, state, now) * 0.25 : 1.2), 0);
    const impact: StrategyPlan["impact"] = impactSum >= 20 ? "HIGH" : impactSum >= 10 ? "MEDIUM" : "LOW";
    return {
      id,
      ...STRATEGY_META[id],
      plan,
      humanMinutes: plan.usedMinutes,
      aiMinutes: plan.ai.reduce((s, a) => s + a.minutes, 0),
      projects,
      impact,
      score: round1(impactSum),
    };
  });

  // Recommendation from the state of the workspace, not just the highest score.
  const nearDone = state.projects.filter((p) => projectProgress(p, state.tasks) >= 0.8 && !isParked(p, now)).length;
  const outbound = state.tasks.filter(
    (t) => t.status === "done" && (t.completedAt ?? 0) > now - 7 * DAY && (t.humanKind === "call" || t.humanKind === "relationship" || /outreach|prospect|pitch|client/i.test(t.title)),
  ).length;
  const finish = finishWhatMatters(state, now)[0];
  const focus = state.settings.focus && state.settings.focus.until > now ? state.projects.find((p) => p.id === state.settings.focus!.projectId) : null;
  let recommended: StrategyId;
  let reason: string;
  if (finish && finish.humanMinutes <= minutes) {
    recommended = "finish";
    reason = `${finish.project.name} is ${Math.round(finish.progress * 100)}% done and needs ~${fmtDuration(finish.humanMinutes)} of you — it fits in this day.`;
  } else if (nearDone >= 2 && outbound < 2) {
    recommended = "revenue";
    reason = `You have ${nearDone} near-finished assets but only ${outbound} outbound action${outbound === 1 ? "" : "s"} this week.`;
  } else if (focus?.kind === "product") {
    recommended = "build";
    reason = `You decided to focus on ${focus.name}.`;
  } else {
    const best = [...strategies].sort((a, b) => b.score - a.score)[0];
    recommended = best.id;
    reason = `Highest expected impact for ${fmtDuration(minutes)} of your time.`;
  }
  return { minutes, strategies, recommended, reason };
}

// ---------------------------------------------------------------------------
// METRICS: AI SAVED YOU, HUMAN LEVERAGE, WORKFLOW EFFICIENCY

export function aiSaved(state: Pick<State, "jobs">, since: number): { minutes: number; count: number } {
  return timeSaved(state.jobs, since);
}

export function savedSummary(state: State, now: number) {
  const tz = state.settings.tzOffsetMin;
  return {
    today: aiSaved(state, startOfToday(now, tz)),
    week: aiSaved(state, startOfWeek(now, tz)),
    month: aiSaved(state, now - 30 * DAY),
  };
}

export interface HumanLeverageKpi {
  pct: number | null;
  minutes: number;
  highMinutes: number;
  wastedMinutes: number;
  wasted: Task[];
}

/** HUMAN LEVERAGE: share of Rémi's time spent on work that needed him. */
export function humanLeverageKpi(state: State, since: number): HumanLeverageKpi {
  const done = state.tasks.filter((t) => t.status === "done" && (t.completedAt ?? 0) >= since && (t.mode === "YOU" || t.mode === "AI_YOU" || t.keptHuman));
  let minutes = 0;
  let high = 0;
  let wastedMinutes = 0;
  const wasted: Task[] = [];
  for (const t of done) {
    const m = t.actualHumanMinutes ?? humanMinutesOf({ ...t, status: "todo" });
    const lev = humanLeverage({ ...t, status: "todo" }, projectOf(state, t)).score;
    minutes += m;
    if (lev >= 6) high += m;
    if (lev < 4 && t.agent) {
      wastedMinutes += m;
      wasted.push(t);
    }
  }
  return { pct: minutes ? Math.round((high / minutes) * 100) : null, minutes, highMinutes: high, wastedMinutes, wasted };
}

export interface Efficiency {
  score: number;
  parts: { label: string; value: number; max: number }[];
  reason: string;
  previous: number | null;
}

/** WORKFLOW EFFICIENCY (0–100), with the one thing that costs the most points. */
export function workflowEfficiency(state: State, now: number): Efficiency {
  const week = humanLeverageKpi(state, now - 7 * DAY);
  const leverage = (week.pct ?? 75) / 100;
  const busy = new Set(state.jobs.filter((j) => j.status === "RUNNING").map((j) => j.agent));
  const byId = byIdMap(state);
  const backlogAgents = new Set(
    state.tasks.filter((t) => isOpen(t) && t.agent && !needsHuman(t) && (t.status === "todo" || t.status === "ai_queued") && isUnblocked(t, byId)).map((t) => t.agent!),
  );
  const wanted = new Set([...busy, ...backlogAgents]);
  const aiUtil = wanted.size ? busy.size / wanted.size : 1;
  const primary = portfolioTriage(state, now).primary;
  const momentum = primary.length ? primary.reduce((s, p) => s + projectMomentum(p.project, state, now).score, 0) / primary.length / 100 : 0.5;
  const open = state.tasks.filter((t) => isOpen(t) && !t.isMission);
  const blockedShare = open.length ? open.filter((t) => t.status === "waiting" || !isUnblocked(t, byId)).length / open.length : 0;
  const waste = week.minutes ? Math.min(1, week.wastedMinutes / week.minutes) : 0;
  const parts = [
    { label: "Human leverage", value: leverage * 35, max: 35 },
    { label: "AI utilization", value: aiUtil * 20, max: 20 },
    { label: "Project momentum", value: momentum * 20, max: 20 },
    { label: "Unblocked work", value: (1 - blockedShare) * 10, max: 10 },
    { label: "No wasted effort", value: (1 - waste) * 15, max: 15 },
  ].map((p) => ({ ...p, value: round1(p.value) }));
  const score = Math.round(parts.reduce((s, p) => s + p.value, 0));
  const worst = [...parts].sort((a, b) => b.max - b.value - (a.max - a.value))[0];
  const idle = [...backlogAgents].filter((a) => !busy.has(a)).length;
  const reasons: Record<string, string> = {
    "Human leverage": `Only ${week.pct ?? 0}% of your time over the last 7 days went to work that needed you.`,
    "AI utilization": `${idle} agent${idle === 1 ? " is" : "s are"} idle while delegable work waits.`,
    "Project momentum": `Your primary projects are slowing down.`,
    "Unblocked work": `${Math.round(blockedShare * 100)}% of open work is blocked.`,
    "No wasted effort": `${fmtDuration(week.wastedMinutes)} spent in the last 7 days on tasks that could have been delegated.`,
  };
  const history = state.settings.efficiencyHistory;
  const today = startOfToday(now, state.settings.tzOffsetMin);
  const previous = [...history].reverse().find((h) => h.day < today)?.score ?? null;
  return { score, parts, reason: worst.max - worst.value < 2 ? "Running close to optimal." : reasons[worst.label], previous };
}

// ---------------------------------------------------------------------------
// AUTOMATION REPORT

export interface AutomationItem {
  phrase: string;
  label: string;
  agent: AgentRole;
  /** Times done by hand in the last 30 days. */
  count: number;
  /** Still on Rémi's own list right now. */
  pending: number;
  minutesPerWeek: number;
}

/** Recurring work Rémi still does by hand that an agent could own. */
export function automationReport(state: State, now: number): { items: AutomationItem[]; minutesPerWeek: number } {
  const since = now - 30 * DAY;
  const groups = new Map<string, { label: string; agent: AgentRole; count: number; pending: number; minutes: number }>();
  for (const t of state.tasks) {
    if (!t.agent || t.isMission) continue;
    const doneByHand = t.status === "done" && (t.completedAt ?? 0) >= since && (t.keptHuman || t.mode === "YOU") && t.automation >= 50;
    const pendingByHand = isOpen(t) && t.keptHuman;
    if (!doneByHand && !pendingByHand) continue;
    const phrase = delegationPhrase(t.title);
    if (!phrase || state.settings.delegationRules.includes(phrase)) continue;
    const g = groups.get(phrase) ?? { label: t.title, agent: t.agent, count: 0, pending: 0, minutes: 0 };
    if (doneByHand) g.count++;
    else g.pending++;
    g.minutes += t.actualHumanMinutes ?? (t.humanMinutes || t.manualMinutes);
    groups.set(phrase, g);
  }
  const items = [...groups.entries()]
    .map(([phrase, g]) => ({
      phrase,
      label: g.label,
      agent: g.agent,
      count: g.count,
      pending: g.pending,
      // Recurring work (≥2 in 30 days) is projected per week; one-offs count once.
      minutesPerWeek: Math.round(g.count + g.pending > 1 ? (g.minutes / 30) * 7 : g.minutes / 4),
    }))
    .sort((a, b) => b.minutesPerWeek - a.minutesPerWeek);
  return { items, minutesPerWeek: items.reduce((s, i) => s + i.minutesPerWeek, 0) };
}

// ---------------------------------------------------------------------------
// REVIEWS

export interface DailyReview {
  human: number;
  ai: number;
  savedMinutes: number;
  leveragePct: number | null;
  wastedMinutes: number;
  postponed: Task[];
  blocked: number;
  tomorrow: Task | null;
  tomorrowProject: Project | null;
}

export function dailyReview(state: State, now: number): DailyReview {
  const since = startOfToday(now, state.settings.tzOffsetMin);
  const done = state.tasks.filter((t) => t.status === "done" && (t.completedAt ?? 0) >= since && !t.isMission);
  const ai = done.filter((t) => latestJob(state.jobs, t.id)?.status === "COMPLETED" && t.mode !== "YOU" && !t.keptHuman);
  const lev = humanLeverageKpi(state, since);
  const d = decideNow(state, now);
  const f = state.settings.focus;
  return {
    human: done.length - ai.length,
    ai: ai.length,
    savedMinutes: aiSaved(state, since).minutes,
    leveragePct: lev.pct,
    wastedMinutes: lev.wastedMinutes,
    postponed: state.tasks.filter((t) => isOpen(t) && t.postponedCount > 0),
    blocked: state.tasks.filter((t) => t.status === "waiting").length,
    tomorrow: d.move,
    tomorrowProject: f ? state.projects.find((p) => p.id === f.projectId) ?? null : d.move ? projectOf(state, d.move) : null,
  };
}

export interface WeeklyReview {
  biggestProgress: { project: Project; done: number } | null;
  bottleneck: { project: Project; why: string } | null;
  mostValuable: Project | null;
  toPause: Project | null;
  toAutomate: AutomationItem[];
  onlyYou: Task[];
  opportunities: number;
  savedMinutes: number;
  leveragePct: number | null;
  next: { primary: Project | null; secondary: Project | null; park: Project[]; aiFocus: string; humanFocus: string };
}

export function weeklyReview(state: State, now: number): WeeklyReview {
  const since = startOfWeek(now, state.settings.tzOffsetMin);
  const perProject = state.projects.map((p) => ({
    p,
    done: state.tasks.filter((t) => t.projectId === p.id && t.status === "done" && (t.completedAt ?? 0) >= since).length,
    blocked: state.tasks.filter((t) => t.projectId === p.id && t.status === "waiting").length,
    postponed: state.tasks.filter((t) => t.projectId === p.id && isOpen(t)).reduce((s, t) => s + t.postponedCount, 0),
  }));
  const best = [...perProject].sort((a, b) => b.done - a.done)[0];
  const neck = [...perProject].sort((a, b) => b.blocked * 2 + b.postponed - (a.blocked * 2 + a.postponed))[0];
  const triage = portfolioTriage(state, now);
  const dead = deadProjects(state, now);
  const byId = byIdMap(state);
  const onlyYou = state.tasks
    .filter((t) => isOpen(t) && isHumanAction(t, byId))
    .sort((a, b) => humanLeverage(b, projectOf(state, b)).score - humanLeverage(a, projectOf(state, a)).score)
    .slice(0, 3);
  const backlogByAgent = new Map<AgentRole, number>();
  for (const t of state.tasks) if (isOpen(t) && !needsHuman(t) && t.agent) backlogByAgent.set(t.agent, (backlogByAgent.get(t.agent) ?? 0) + t.aiMinutes);
  const aiFocus = [...backlogByAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => AGENTS[a].short.toLowerCase());
  const humanKinds = new Map<string, number>();
  for (const t of onlyYou) humanKinds.set(t.humanKind ?? "generic", (humanKinds.get(t.humanKind ?? "generic") ?? 0) + 1);
  const kindLabel: Record<string, string> = { call: "client calls", meeting: "meetings", relationship: "client acquisition", decision: "creative decisions", onsite: "on-site visits", review: "reviews", creative: "creative work", signature: "signatures", generic: "your own work" };
  return {
    biggestProgress: best && best.done ? { project: best.p, done: best.done } : null,
    bottleneck: neck && neck.blocked + neck.postponed > 0 ? { project: neck.p, why: neck.blocked ? `${neck.blocked} task${neck.blocked > 1 ? "s" : ""} waiting on others` : `postponed ${neck.postponed} times` } : null,
    mostValuable: triage.primary[0]?.project ?? null,
    toPause: dead[0]?.project ?? triage.park[0]?.project ?? null,
    toAutomate: automationReport(state, now).items.slice(0, 3),
    onlyYou,
    opportunities: state.opportunities.filter((o) => o.status === "open").length,
    savedMinutes: aiSaved(state, since).minutes,
    leveragePct: humanLeverageKpi(state, since).pct,
    next: {
      primary: triage.primary[0]?.project ?? null,
      secondary: triage.primary[1]?.project ?? triage.secondary[0]?.project ?? null,
      park: [...new Set([...dead.map((d) => d.project), ...triage.park.map((p) => p.project)])],
      aiFocus: aiFocus.length ? aiFocus.join(" + ") : "keeping the queue empty",
      humanFocus: [...humanKinds.keys()].slice(0, 2).map((k) => kindLabel[k]).join(" + ") || "high-leverage decisions",
    },
  };
}

// ---------------------------------------------------------------------------
// "Tell your Chief of Staff" — strategic memory from plain sentences.

export interface ParsedIntent {
  kind: "focus" | "park" | "note";
  projectId: string | null;
  days: number;
}

/** Heuristic parser (FR/EN) for things like "I'm focusing on Patrick Pons this week". */
export function parseIntent(text: string, projects: Pick<Project, "id" | "name">[], now: number, tzOffsetMin: number): ParsedIntent {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const project = projects.find((p) => t.includes(p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""))) ?? null;
  let days = 2;
  const n = t.match(/(\d+)\s*(days?|jours?|j\b)/);
  const w = t.match(/(\d+)\s*(weeks?|semaines?)/);
  if (n) days = Number(n[1]);
  else if (w) days = Number(w[1]) * 7;
  else if (/this week|cette semaine/.test(t)) {
    const dow = (new Date(now - tzOffsetMin * MIN).getUTCDay() + 6) % 7;
    days = Math.max(1, 7 - dow);
  } else if (/today|aujourd hui|aujourd'hui/.test(t)) days = 1;
  else if (/tomorrow|demain/.test(t)) days = 2;
  else if (/next week|semaine prochaine/.test(t)) days = 7;
  if (project && /\b(focus|focusing|concentr\w*|priorit\w*|finish|finir|terminer)\b/.test(t)) return { kind: "focus", projectId: project.id, days };
  if (project && /\b(park|parking|pause|stop|mettre de cote|abandon\w*|geler)\b/.test(t)) return { kind: "park", projectId: project.id, days: n || w ? days : 7 };
  return { kind: "note", projectId: project?.id ?? null, days };
}

/** Opportunity steps a user can keep or drop before accepting (MODIFY). */
export function selectDrafts(drafts: TaskDraft[], include?: number[]): TaskDraft[] {
  if (!include) return drafts;
  const keep = new Set(include);
  const kept = drafts.map((d, i) => ({ d, i })).filter(({ i }) => keep.has(i));
  const remap = new Map(kept.map(({ i }, j) => [i, j]));
  return kept.map(({ d }) => ({ ...d, after: (d.after ?? []).map((a) => remap.get(a)).filter((x): x is number => x !== undefined) }));
}

export function minutesUntilEndOfDay(state: Pick<State, "settings">, now: number): number {
  return Math.max(0, state.settings.dayEndMin - localMinuteOfDay(now, state.settings.tzOffsetMin));
}
