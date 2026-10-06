import "server-only";
import { randomUUID } from "node:crypto";
import { AGENTS } from "../agents.ts";
import { classifyTask, delegationPhrase } from "../classifier.ts";
import {
  aiPriority,
  humanLeverage,
  isParked,
  PAUSE_INDEFINITE_DAYS,
  needsHuman,
  parseIntent,
  portfolioTriage,
  rankAll,
  selectDrafts,
  simulateDay,
  workflowEfficiency,
} from "../optimizer.ts";
import {
  computeHealth,
  discoverOpportunities,
  fmtDuration,
  isOpen,
  isUnblocked,
  nextMove,
  projectProgress,
  startOfToday,
} from "../planner.ts";
import type {
  Action,
  Activity,
  AgentJob,
  AgentRole,
  Decision,
  Task,
  TaskAnalysis,
  TaskDraft,
  WorkspaceState,
} from "../types.ts";
import { claudeEnabled, classifyWithClaude, executeWithClaude } from "./claude.ts";
import { getStore, type Store } from "./db.ts";
import { seed } from "./seed.ts";

// The fundamental loop: OBSERVE → UNDERSTAND → PRIORITIZE → CLASSIFY →
// DELEGATE → EXECUTE → MONITOR → REPORT → REPLAN.
// `advance()` runs on every read, so the workspace is always up to date
// without a background scheduler: job progress is a function of time.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const id = () => randomUUID().slice(0, 12);

// ---------------------------------------------------------------------------
// Public API

export function readState(tzOffsetMin: number | null): WorkspaceState {
  const s = getStore();
  if (!s.state.settings) seed(s, Date.now(), tzOffsetMin ?? 0);
  advance(s, Date.now());
  s.flush();
  return snapshot(s);
}

export async function dispatch(action: Action, tzOffsetMin: number | null): Promise<WorkspaceState> {
  const s = getStore();
  if (!s.state.settings) seed(s, Date.now(), tzOffsetMin ?? 0);
  // Classification may call Claude: do it before taking the "now" snapshot.
  const analysis =
    action.type === "create_task" ? await analyze(s, action.title, action.projectId) : null;
  const now = Date.now();
  apply(s, action, now, analysis);
  advance(s, now);
  s.flush();
  return snapshot(s);
}

function snapshot(s: Store): WorkspaceState {
  return {
    now: Date.now(),
    projects: s.state.projects,
    tasks: s.state.tasks,
    jobs: s.state.jobs,
    activity: s.state.activity.slice(0, 80),
    opportunities: s.state.opportunities,
    decisions: s.state.decisions,
    settings: s.state.settings,
    claudeEnabled: claudeEnabled(),
  };
}

async function analyze(s: Store, title: string, projectId: string | null): Promise<TaskAnalysis> {
  const heuristic = classifyTask(title, { delegationRules: s.state.settings.delegationRules });
  if (heuristic.mission.length || heuristic.mode === "WAITING") return heuristic;
  const project = s.state.projects.find((p) => p.id === projectId) ?? null;
  return (await classifyWithClaude(title, heuristic, project)) ?? heuristic;
}

// ---------------------------------------------------------------------------
// Helpers

function log(s: Store, now: number, actor: Activity["actor"], kind: Activity["kind"], text: string, taskId: string | null = null) {
  const a: Activity = { id: id(), at: now, actor, kind, text, taskId };
  s.state.activity.unshift(a);
  if (s.state.activity.length > 200) s.state.activity.length = 200;
  s.touchActivity(a);
}

function task(s: Store, taskId: string): Task | undefined {
  return s.state.tasks.find((t) => t.id === taskId);
}

function save(s: Store, t: Task) {
  s.touch("task", t.id);
  const p = s.state.projects.find((x) => x.id === t.projectId);
  if (p) s.touch("project", p.id);
}

function bumpProject(s: Store, t: Task, now: number) {
  const p = s.state.projects.find((x) => x.id === t.projectId);
  if (p) {
    p.lastActivityAt = now;
    s.touch("project", p.id);
  }
}

export function newTask(partial: Partial<Task> & Pick<Task, "title">, now: number): Task {
  return {
    id: id(),
    projectId: null,
    parentId: null,
    notes: null,
    mode: "YOU",
    automation: 0,
    agent: null,
    risk: "low",
    humanValue: 3,
    priority: "medium",
    humanKind: null,
    humanMinutes: 0,
    aiMinutes: 0,
    manualMinutes: 0,
    status: "todo",
    reason: "",
    aiPrep: [],
    tags: [],
    waitingOn: null,
    followUpAt: null,
    scheduledAt: null,
    location: null,
    dependsOn: [],
    source: "user",
    rank: 999,
    keptHuman: false,
    autoRun: false,
    isMission: false,
    postponedCount: 0,
    actualHumanMinutes: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    delegatedAt: null,
    unlockedAt: null,
    handoffAt: null,
    unlockedBy: null,
    ...partial,
  };
}

function fromAnalysis(title: string, a: TaskAnalysis, extra: Partial<Task>, now: number): Task {
  return newTask(
    {
      title,
      mode: a.mode,
      automation: a.automation,
      agent: a.agent,
      risk: a.risk,
      humanValue: a.humanValue,
      priority: a.priority,
      humanKind: a.humanKind,
      humanMinutes: a.humanMinutes,
      aiMinutes: a.aiMinutes,
      manualMinutes: a.manualMinutes,
      reason: a.reason,
      aiPrep: a.aiPrep,
      tags: a.tags,
      waitingOn: a.waitingOn,
      status: a.mode === "WAITING" ? "waiting" : "todo",
      ...extra,
    },
    now,
  );
}

/** Turn plan drafts (mission steps, opportunity steps) into real, chained tasks. */
function createChain(s: Store, drafts: TaskDraft[], base: Partial<Task>, now: number): Task[] {
  const created: Task[] = [];
  drafts.forEach((d, i) => {
    const a = classifyTask(d.title);
    const mode = d.mode ?? a.mode;
    const agent = d.agent !== undefined ? d.agent : a.agent;
    const human = mode === "YOU";
    const t = fromAnalysis(
      d.title,
      {
        ...a,
        mode,
        agent,
        humanKind: d.humanKind ?? (human ? (a.humanKind ?? "generic") : a.humanKind),
        risk: d.risk ?? a.risk,
        automation: mode === "AI" ? ((d.risk ?? a.risk) === "low" ? 100 : 75) : mode === "AI_YOU" ? 50 : 0,
        humanValue: human ? Math.max(a.humanValue, 4) as Task["humanValue"] : Math.min(a.humanValue, 2) as Task["humanValue"],
        humanMinutes: human ? (a.humanMinutes || 15) : a.humanMinutes,
        aiMinutes: human ? 0 : (a.aiMinutes || AGENTS[agent ?? "operations"].aiMinutes),
        manualMinutes: a.manualMinutes || (agent ? AGENTS[agent].manualMinutes : 15),
        tags: d.tags ?? a.tags,
        reason: human ? (a.mode === "YOU" ? a.reason : "Needs your judgment before it goes further.") : a.reason,
      },
      { ...base, autoRun: true, dependsOn: (d.after ?? []).map((j) => created[j]?.id).filter(Boolean) as string[] },
      now + i, // stable ordering
    );
    created.push(t);
    s.state.tasks.push(t);
    save(s, t);
  });
  return created;
}

// ---------------------------------------------------------------------------
// Delegation & execution

function enqueue(s: Store, t: Task, now: number, opts: { scheduledFor?: number | null; reason?: string } = {}): AgentJob | null {
  if (!t.agent || t.isMission) return null;
  const active = s.state.jobs.find(
    (j) => j.task_id === t.id && (j.status === "QUEUED" || j.status === "RUNNING" || j.status === "WAITING_FOR_APPROVAL"),
  );
  if (active) return active;
  const highRisk = t.risk === "high";
  const job: AgentJob = {
    id: id(),
    task_id: t.id,
    agent: t.agent,
    status: highRisk ? "WAITING_FOR_APPROVAL" : "QUEUED",
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    artifacts: [],
    human_approval_required: t.risk !== "low",
    created_at: now,
    progress: 0,
    current_step: highRisk ? "Waiting for your go-ahead" : null,
    executor: "simulated",
    est_duration_ms: Math.max(1, t.aiMinutes) * s.state.settings.simSecondsPerMinute * 1000,
    scheduled_for: opts.scheduledFor ?? null,
    approval_stage: highRisk ? "before" : null,
    saved_minutes: 0,
  };
  s.state.jobs.push(job);
  s.touch("job", job.id);
  t.status = highRisk ? "awaiting_approval" : "ai_queued";
  save(s, t);
  if (highRisk) {
    log(s, now, "system", "approval", `High-risk task needs your approval before ${AGENTS[t.agent].name} starts: ${t.title}`, t.id);
  } else if (opts.reason) {
    log(s, now, t.agent, "start", `${opts.reason}: ${t.title}`, t.id);
  }
  return job;
}

function startJob(s: Store, job: AgentJob, now: number) {
  const t = task(s, job.task_id);
  if (!t) return;
  job.status = "RUNNING";
  job.started_at = now;
  job.progress = 0;
  job.current_step = AGENTS[job.agent].steps[0].replace("{n}", "");
  job.executor = claudeEnabled() && AGENTS[job.agent].textual ? "claude" : "simulated";
  s.touch("job", job.id);
  t.status = "ai_running";
  save(s, t);
  log(s, now, job.agent, "start", `${AGENTS[job.agent].name} started ${lower(t.title)}`, t.id);
  if (job.executor === "claude") void runWithClaude(job.id);
}

async function runWithClaude(jobId: string) {
  const s = getStore();
  const job = s.state.jobs.find((j) => j.id === jobId);
  const t = job && task(s, job.task_id);
  if (!job || !t) return;
  const project = s.state.projects.find((p) => p.id === t.projectId);
  const parent = t.parentId ? task(s, t.parentId) : null;
  const context = [
    project ? `Project: ${project.name} — ${project.description}` : "",
    parent ? `This prepares a human task: "${parent.title}". Prepare: ${parent.aiPrep.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const result = await executeWithClaude(t, job.agent, context);
    if (job.status !== "RUNNING") return; // cancelled meanwhile
    finishJob(s, job, Date.now(), result);
  } catch (err) {
    if (job.status !== "RUNNING") return;
    job.status = "FAILED";
    job.error = err instanceof Error ? err.message : String(err);
    job.completed_at = Date.now();
    s.touch("job", job.id);
    t.status = "todo";
    save(s, t);
    log(s, Date.now(), job.agent, "fail", `${AGENTS[job.agent].name} failed on ${lower(t.title)} — ${job.error}`, t.id);
  }
  s.flush();
}

function finishJob(s: Store, job: AgentJob, now: number, result: string) {
  const t = task(s, job.task_id);
  if (!t) return;
  job.progress = 1;
  job.result = result;
  job.current_step = "Done";
  job.artifacts = artifactsFor(t, job);
  s.touch("job", job.id);
  if (job.human_approval_required) {
    job.status = "WAITING_FOR_APPROVAL";
    job.approval_stage = "after";
    t.status = "awaiting_approval";
    save(s, t);
    log(s, now, job.agent, "approval", `Ready for your approval: ${t.title}`, t.id);
    return;
  }
  completeJob(s, job, now);
}

function completeJob(s: Store, job: AgentJob, now: number) {
  const t = task(s, job.task_id);
  if (!t) return;
  job.status = "COMPLETED";
  job.completed_at = now;
  job.progress = 1;
  job.approval_stage = null;
  job.saved_minutes = Math.max(0, t.manualMinutes - t.humanMinutes);
  s.touch("job", job.id);
  bumpProject(s, t, now);

  if (t.mode === "AI_YOU") {
    t.status = "your_turn";
    t.handoffAt = now;
    save(s, t);
    log(s, now, job.agent, "handoff", `AI preparation complete — your turn: ${t.title}`, t.id);
  } else {
    t.status = "done";
    t.completedAt = now;
    save(s, t);
    log(s, now, job.agent, "complete", `${AGENTS[job.agent].name} completed ${lower(t.title)}`, t.id);
    afterDone(s, t, now);
  }

  // Prep for a human task: tell the human task its material is ready.
  if (t.parentId) {
    const parent = task(s, t.parentId);
    if (parent && !parent.isMission && isOpen(parent)) {
      parent.handoffAt = now;
      save(s, parent);
    }
  }
}

/** Shared consequences of a task reaching DONE: unlocks, mission roll-up. */
function afterDone(s: Store, done: Task, now: number) {
  const byId = new Map(s.state.tasks.map((t) => [t.id, t]));
  for (const t of s.state.tasks) {
    if (!t.dependsOn.includes(done.id) || t.status !== "todo") continue;
    if (!isUnblocked(t, byId)) continue;
    t.unlockedAt = now;
    t.unlockedBy = done.title;
    save(s, t);
    if (needsHuman(t) || t.mode === "YOU") log(s, now, "system", "handoff", `You’re unblocked — “${t.title}” is ready for you`, t.id);
    else log(s, now, "system", "unlock", `Unlocked: ${t.title}`, t.id);
    const aiSide = t.mode === "AI" || t.mode === "AI_YOU";
    if (aiSide && !t.keptHuman && (t.autoRun || (s.state.settings.autopilot && t.risk === "low"))) {
      enqueue(s, t, now);
    }
  }
  if (done.parentId) {
    const parent = byId.get(done.parentId);
    if (parent?.isMission && isOpen(parent)) {
      const children = s.state.tasks.filter((t) => t.parentId === parent.id);
      if (children.every((c) => c.status === "done" || c.status === "cancelled")) {
        parent.status = "done";
        parent.completedAt = now;
        save(s, parent);
        log(s, now, "system", "complete", `Mission complete: ${parent.title}`, parent.id);
      }
    }
  }
}

function artifactsFor(t: Task, job: AgentJob): string[] {
  const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  switch (job.agent) {
    case "coding":
      return [`${slug}.diff`, "test-report.txt"];
    case "design":
      return [`${slug}-concepts.fig`];
    case "research":
    case "analyst":
      return [`${slug}-report.md`];
    default:
      return [`${slug}.md`];
  }
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function simulatedResult(t: Task, job: AgentJob): string {
  const n = 6 + (hash(job.id) % 9);
  const a = AGENTS[job.agent];
  return [
    `**${a.name} — ${t.title}**`,
    "",
    `_Simulated run. Set ANTHROPIC_API_KEY to have textual agents produce real deliverables; coding jobs need a repository runner (see README)._`,
    "",
    `- Scope reviewed: ${n} items`,
    `- Output: ${artifactsFor(t, job).join(", ")}`,
    t.parentId ? `- Prepared for: ${task(getStore(), t.parentId)?.title ?? "a human task"}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// The loop

export function advance(s: Store, now: number) {
  const st = s.state;
  const settings = st.settings;

  const projectById = new Map(st.projects.map((p) => [p.id, p]));
  const parked = (t: Task) => isParked(t.projectId ? projectById.get(t.projectId) ?? null : null, now);
  let changed = false;

  // Expire focus and parking decisions.
  if (settings.focus && settings.focus.until <= now) {
    log(s, now, "system", "system", `Focus on ${projectById.get(settings.focus.projectId)?.name ?? "project"} ended`, null);
    settings.focus = null;
    s.touchSettings();
    changed = true;
  }
  for (const p of st.projects) {
    if (p.parkedUntil && p.parkedUntil <= now) {
      p.parkedUntil = null;
      s.touch("project", p.id);
      log(s, now, "system", "system", `${p.name}’s pause is over — worth a look`, null);
      changed = true;
    }
  }

  // DELEGATE — autopilot takes low-risk work; Maximum Leverage and Focus take
  // everything the AI can prepare (medium risk still stops for approval).
  {
    const byId = new Map(st.tasks.map((t) => [t.id, t]));
    const focusId = settings.focus?.projectId ?? null;
    for (const t of st.tasks) {
      if (t.status !== "todo" || t.keptHuman || t.isMission || !t.agent || parked(t)) continue;
      if (t.mode !== "AI" && t.mode !== "AI_YOU") continue;
      if (!isUnblocked(t, byId)) continue;
      const why =
        settings.autopilot && t.risk === "low"
          ? "Autopilot picked up"
          : settings.maxLeverage && t.risk !== "high"
            ? "Maximum leverage: delegated"
            : focusId && t.projectId === focusId && t.risk !== "high"
              ? "Focus: delegated"
              : null;
      if (!why) continue;
      const job = enqueue(s, t, now);
      if (job) log(s, now, t.agent, "start", `${why} ${lower(t.title)}`, t.id);
    }
    // Maximum Leverage / Focus: prepare every human action the AI can prepare.
    if (settings.maxLeverage || focusId) {
      for (const t of [...st.tasks]) {
        if (t.status !== "todo" || t.mode !== "YOU" || !t.aiPrep.length || !t.agent || parked(t)) continue;
        if (!settings.maxLeverage && t.projectId !== focusId) continue;
        if (st.tasks.some((c) => c.parentId === t.id)) continue;
        createPrep(s, t, now);
      }
    }
    // Maximum Leverage: don't let blocked work sit — follow up after a day of silence.
    if (settings.maxLeverage) {
      for (const t of st.tasks) {
        if (t.status === "waiting" && t.followUpAt && t.followUpAt > now && now - t.createdAt > DAY && !st.tasks.some((c) => c.parentId === t.id && isOpen(c))) {
          t.followUpAt = now;
          save(s, t);
        }
      }
    }
  }

  // MONITOR — waiting tasks get automatic follow-ups.
  for (const t of [...st.tasks]) {
    if (t.status !== "waiting" || !t.followUpAt || t.followUpAt > now) continue;
    const who = t.waitingOn ?? "them";
    const f = newTask(
      {
        title: `Draft follow-up to ${who}`,
        projectId: t.projectId,
        parentId: t.id,
        mode: "AI",
        automation: 75,
        agent: "content",
        risk: "medium",
        humanValue: 2,
        priority: t.priority,
        aiMinutes: 4,
        manualMinutes: 15,
        humanMinutes: 2,
        reason: "Polite nudge, drafted for you. Sending it is your call.",
        tags: ["Follow-up"],
        source: "ai",
        autoRun: true,
      },
      now,
    );
    st.tasks.push(f);
    save(s, f);
    t.followUpAt = now + DAY;
    save(s, t);
    log(s, now, "operations", "discover", `${t.title} is still blocked — drafting a follow-up to ${who}`, f.id);
    enqueue(s, f, now);
  }

  // EXECUTE — one job per agent at a time; the workforce runs in parallel.
  // The queue is not first-come-first-served: work that unblocks Rémi goes first.
  const busy = new Set(st.jobs.filter((j) => j.status === "RUNNING").map((j) => j.agent));
  const queued = st.jobs
    .filter((j) => j.status === "QUEUED" && (!j.scheduled_for || j.scheduled_for <= now))
    .sort((a, b) => priorityOf(s, b, now) - priorityOf(s, a, now) || a.created_at - b.created_at);
  for (const j of queued) {
    if (busy.has(j.agent)) continue;
    startJob(s, j, now);
    busy.add(j.agent);
  }

  // Progress for simulated jobs is a pure function of elapsed time.
  for (const j of st.jobs) {
    if (j.status !== "RUNNING" || !j.started_at) continue;
    const t = task(s, j.task_id);
    if (!t) continue;
    const steps = AGENTS[j.agent].steps;
    const elapsed = now - j.started_at;
    const raw = elapsed / j.est_duration_ms;
    const progress = j.executor === "claude" ? Math.min(0.94, 1 - Math.exp(-raw * 1.6)) : Math.min(1, raw);
    const stepIdx = Math.min(steps.length - 1, Math.floor(progress * steps.length));
    const n = 6 + (hash(j.id) % 9);
    const step = steps[stepIdx].replace("{n}", String(n));
    if (step !== j.current_step && progress < 1) {
      j.current_step = step;
      // Narrate only the step that carries information (the one with a number).
      if (steps[stepIdx].includes("{n}")) log(s, now, j.agent, "progress", `${step} — ${t.title}`, t.id);
    }
    j.progress = progress;
    s.touch("job", j.id);
    if (j.executor === "simulated" && progress >= 1) {
      finishJob(s, j, now, simulatedResult(t, j));
      changed = true;
    }
  }

  // OBSERVE — project progress and health.
  for (const p of st.projects) {
    const progress = projectProgress(p, st.tasks);
    const health = computeHealth(p, st.tasks, now);
    if (progress !== p.progress) {
      p.progress = progress;
      s.touch("project", p.id);
    }
    if (health !== p.health) {
      log(s, now, "system", "system", `${p.name}: ${healthLabel(p.health)} → ${healthLabel(health)}`, null);
      p.health = health;
      p.healthChangedAt = now;
      s.touch("project", p.id);
      changed = true;
    }
  }

  // UNDERSTAND — surface what nobody asked for.
  const known = new Set(st.opportunities.map((o) => o.key));
  for (const prop of discoverOpportunities(st, now)) {
    if (known.has(prop.key)) continue;
    const o = { id: id(), status: "open" as const, createdAt: now, ...prop };
    st.opportunities.push(o);
    s.touch("opportunity", o.id);
    log(s, now, "analyst", "discover", `Found an opportunity: ${prop.title}`, null);
    changed = true;
  }

  // REASSESS — priorities are not static: re-rank whenever the workspace changes,
  // unless Rémi just ordered his list by hand.
  if (changed && (!settings.manualOrderAt || now - settings.manualOrderAt > 30 * MIN)) rerank(s, now);

  // Daily snapshot of workflow efficiency (for the trend).
  const today = startOfToday(now, settings.tzOffsetMin);
  const last = settings.efficiencyHistory[settings.efficiencyHistory.length - 1];
  if (!last || last.day < today) {
    settings.efficiencyHistory.push({ day: today, score: workflowEfficiency({ ...st, settings }, now).score });
    if (settings.efficiencyHistory.length > 60) settings.efficiencyHistory.shift();
    s.touchSettings();
  }
}

function priorityOf(s: Store, j: AgentJob, now: number): number {
  const t = task(s, j.task_id);
  return t ? aiPriority(t, s.state, now).score : -1;
}

function healthLabel(h: string) {
  return { on_track: "on track", at_risk: "at risk", attention: "needs attention", idle: "idle" }[h] ?? h;
}

function lower(title: string) {
  return title.charAt(0).toLowerCase() + title.slice(1);
}

function rerank(s: Store, now: number) {
  const ranks = rankAll(s.state, now);
  for (const t of s.state.tasks) {
    const r = ranks.get(t.id) ?? 999;
    if (t.rank !== r) {
      t.rank = r;
      s.touch("task", t.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Actions

function apply(s: Store, action: Action, now: number, analysis: TaskAnalysis | null) {
  const st = s.state;
  switch (action.type) {
    case "create_task": {
      const a = analysis!;
      const title = action.title.trim();
      if (!title) return;
      if (a.mission.length) {
        const root = fromAnalysis(title, a, { projectId: action.projectId, isMission: true, autoRun: true }, now);
        st.tasks.push(root);
        save(s, root);
        const chain = createChain(s, a.mission, { projectId: action.projectId, parentId: root.id, source: "ai", priority: root.priority }, now);
        log(s, now, "system", "system", `Mission created: ${title} — ${chain.filter((c) => c.mode !== "YOU").length} AI steps, then ${chain.filter((c) => c.mode === "YOU").length} for you`, root.id);
        if (action.intent !== "me") {
          const byId = new Map(st.tasks.map((t) => [t.id, t]));
          for (const c of chain) if (c.mode !== "YOU" && isUnblocked(c, byId)) enqueue(s, c, now);
        }
        rerank(s, now);
        return;
      }
      const t = fromAnalysis(title, a, { projectId: action.projectId }, now);
      if (t.mode === "WAITING") t.followUpAt = now + DAY;
      st.tasks.push(t);
      save(s, t);
      bumpProject(s, t, now);
      const aiCapable = (t.mode === "AI" || t.mode === "AI_YOU") && t.agent;
      if (action.intent === "me" && aiCapable) {
        t.keptHuman = true;
        save(s, t);
      } else if (aiCapable && (action.intent === "run" || (action.intent === "auto" && st.settings.autopilot && t.risk === "low"))) {
        t.delegatedAt = now;
        enqueue(s, t, now, { reason: "Delegated on creation" });
      } else if (aiCapable && action.intent === "schedule") {
        enqueue(s, t, now, { scheduledFor: now + 60 * MIN, reason: "Scheduled" });
      }
      // Human-only task with preparable material → AI prepares it right away.
      if (t.mode === "YOU" && t.aiPrep.length > 0 && t.agent) createPrep(s, t, now);
      rerank(s, now);
      return;
    }

    case "run_task":
    case "delegate": {
      const t = task(s, action.taskId);
      if (!t || !isOpen(t)) return;
      if (t.mode === "YOU" && !t.keptHuman) {
        // A human-only task can't be delegated; its preparation can.
        if (t.aiPrep.length && !st.tasks.some((c) => c.parentId === t.id && isOpen(c))) createPrep(s, t, now);
        return;
      }
      if (t.mode === "WAITING") return;
      t.keptHuman = false;
      t.delegatedAt = now;
      if (!t.agent) t.agent = "operations";
      t.status = "todo";
      save(s, t);
      enqueue(s, t, now);
      log(s, now, t.agent, "start", `Delegated to ${AGENTS[t.agent].name}: ${t.title}`, t.id);
      rerank(s, now);
      return;
    }

    case "run_all": {
      for (const tid of action.taskIds) {
        const t = task(s, tid);
        if (t && t.status === "todo" && (t.mode === "AI" || t.mode === "AI_YOU")) {
          t.keptHuman = false;
          t.delegatedAt = now;
          enqueue(s, t, now);
        }
      }
      log(s, now, "system", "start", `${action.taskIds.length} tasks handed to the AI workforce`, null);
      return;
    }

    case "assign_me": {
      const t = task(s, action.taskId);
      if (!t) return;
      for (const j of st.jobs) {
        if (j.task_id === t.id && (j.status === "QUEUED" || j.status === "WAITING_FOR_APPROVAL")) {
          j.status = "CANCELLED";
          s.touch("job", j.id);
        }
      }
      t.keptHuman = true;
      t.status = "todo";
      if (!t.humanKind) t.humanKind = "generic";
      if (!t.humanMinutes) t.humanMinutes = t.manualMinutes;
      save(s, t);
      log(s, now, "you", "human", `You took ${lower(t.title)} yourself`, t.id);
      rerank(s, now);
      return;
    }

    case "start_task": {
      const t = task(s, action.taskId);
      if (!t) return;
      t.startedAt = now;
      save(s, t);
      log(s, now, "you", "human", `You started ${lower(t.title)}`, t.id);
      return;
    }

    case "complete_task": {
      const t = task(s, action.taskId);
      if (!t || !isOpen(t)) return;
      const prevMove = nextMove(st, now);
      t.status = "done";
      t.completedAt = now;
      if (t.startedAt && (t.mode === "YOU" || t.keptHuman || t.mode === "AI_YOU")) {
        const planned = t.humanMinutes || t.manualMinutes || 30;
        t.actualHumanMinutes = Math.max(1, Math.min(planned * 4, Math.round((now - t.startedAt) / MIN)));
      }
      save(s, t);
      bumpProject(s, t, now);
      log(s, now, "you", "human", `You completed ${lower(t.title)}`, t.id);
      // Close any AI job left on it (e.g. approval stage) and its open prep.
      for (const j of st.jobs) {
        if (j.task_id === t.id && (j.status === "WAITING_FOR_APPROVAL" || j.status === "QUEUED")) {
          j.status = "COMPLETED";
          j.completed_at = now;
          j.saved_minutes = Math.max(0, t.manualMinutes - t.humanMinutes);
          s.touch("job", j.id);
        }
      }
      afterDone(s, t, now);
      rerank(s, now);

      const spent = t.startedAt ? Math.max(1, Math.round((now - t.startedAt) / MIN)) : t.humanMinutes || t.manualMinutes;
      if (t.keptHuman && t.agent) {
        st.settings.delegationPrompt = {
          taskId: t.id,
          title: t.title,
          spentMinutes: spent,
          aiMinutes: t.aiMinutes || AGENTS[t.agent].aiMinutes,
          phrase: delegationPhrase(t.title),
        };
      }
      const next = nextMove(st, now);
      if (prevMove?.id === t.id && next) {
        const early = t.startedAt && t.humanMinutes && spent < t.humanMinutes * 0.8;
        st.settings.dayUpdate = {
          at: now,
          message: early
            ? `You finished ${t.humanMinutes - spent} min early. I moved “${next.title}” forward.`
            : `Day updated. “${next.title}” is your next move.`,
        };
      }
      s.touchSettings();
      return;
    }

    case "approve_job": {
      const j = st.jobs.find((x) => x.id === action.jobId);
      const t = j && task(s, j.task_id);
      if (!j || !t || j.status !== "WAITING_FOR_APPROVAL") return;
      if (j.approval_stage === "before") {
        j.status = "QUEUED";
        j.approval_stage = null;
        j.current_step = null;
        s.touch("job", j.id);
        t.status = "ai_queued";
        save(s, t);
        log(s, now, "you", "approval", `You approved the start of ${lower(t.title)}`, t.id);
      } else {
        log(s, now, "you", "approval", `You approved ${lower(t.title)}`, t.id);
        completeJob(s, j, now);
      }
      rerank(s, now);
      return;
    }

    case "reject_job": {
      const j = st.jobs.find((x) => x.id === action.jobId);
      const t = j && task(s, j.task_id);
      if (!j || !t) return;
      j.status = "CANCELLED";
      j.completed_at = now;
      s.touch("job", j.id);
      t.status = "todo";
      t.keptHuman = true;
      save(s, t);
      log(s, now, "you", "approval", `You sent back ${lower(t.title)} — it stays with you`, t.id);
      rerank(s, now);
      return;
    }

    case "cancel_job": {
      const j = st.jobs.find((x) => x.id === action.jobId);
      const t = j && task(s, j.task_id);
      if (!j || !t) return;
      j.status = "CANCELLED";
      j.completed_at = now;
      s.touch("job", j.id);
      t.status = "todo";
      save(s, t);
      log(s, now, "you", "system", `Cancelled ${lower(t.title)}`, t.id);
      return;
    }

    case "retry_job": {
      const j = st.jobs.find((x) => x.id === action.jobId);
      const t = j && task(s, j.task_id);
      if (!j || !t) return;
      t.status = "todo";
      enqueue(s, t, now, { reason: "Retrying" });
      return;
    }

    case "accept_opportunity": {
      const o = st.opportunities.find((x) => x.id === action.opportunityId);
      if (!o || o.status !== "open") return;
      o.status = "accepted";
      s.touch("opportunity", o.id);
      const drafts = selectDrafts(o.drafts, action.include);
      if (!drafts.length) return;
      const chain = createChain(s, drafts, { projectId: o.projectId, source: "ai" }, now);
      const byId = new Map(st.tasks.map((t) => [t.id, t]));
      let started = 0;
      for (const c of chain) {
        if (c.mode !== "YOU" && isUnblocked(c, byId)) {
          enqueue(s, c, now);
          started++;
        }
      }
      log(s, now, "system", "discover", `AI-generated mission accepted: ${o.title} — ${started} AI task${started === 1 ? "" : "s"} started`, null);
      rerank(s, now);
      return;
    }

    case "dismiss_opportunity": {
      const o = st.opportunities.find((x) => x.id === action.opportunityId);
      if (!o) return;
      o.status = "dismissed";
      s.touch("opportunity", o.id);
      return;
    }

    case "set_autopilot": {
      st.settings.autopilot = action.on;
      s.touchSettings();
      log(s, now, "system", "system", action.on ? "Autopilot on — low-risk AI work runs automatically" : "Autopilot off — AI work waits for your go", null);
      return;
    }

    case "analyze": {
      rerank(s, now);
      st.settings.lastAnalysisAt = now;
      s.touchSettings();
      const byId = new Map(st.tasks.map((t) => [t.id, t]));
      const humans = st.tasks.filter((t) => isOpen(t) && (t.mode === "YOU" || t.status === "your_turn") && isUnblocked(t, byId)).length;
      const ai = st.tasks.filter((t) => isOpen(t) && !t.isMission && (t.mode === "AI" || t.mode === "AI_YOU") && t.status !== "your_turn").length;
      const move = nextMove(st, now);
      log(s, now, "system", "system", `Re-planned your day: ${humans} for you, ${ai} for the AI${move ? ` — next move: ${move.title}` : ""}`, move?.id ?? null);
      return;
    }

    case "reorder": {
      st.settings.manualOrderAt = now;
      s.touchSettings();
      action.taskIds.forEach((tid, i) => {
        const t = task(s, tid);
        if (t) {
          t.rank = i;
          s.touch("task", t.id);
        }
      });
      const set = new Set(action.taskIds);
      st.tasks
        .filter((t) => !set.has(t.id))
        .sort((a, b) => a.rank - b.rank)
        .forEach((t, i) => {
          t.rank = action.taskIds.length + i;
          s.touch("task", t.id);
        });
      return;
    }

    case "delegation_answer": {
      const p = st.settings.delegationPrompt;
      if (p && action.yes && p.phrase && !st.settings.delegationRules.includes(p.phrase)) {
        st.settings.delegationRules.push(p.phrase);
        log(s, now, "system", "system", `Noted: “${p.phrase}” tasks go to the AI from now on`, null);
      }
      st.settings.delegationPrompt = null;
      s.touchSettings();
      return;
    }

    case "dismiss_day_update": {
      st.settings.dayUpdate = null;
      s.touchSettings();
      return;
    }

    case "postpone": {
      const t = task(s, action.taskId);
      if (!t || !isOpen(t)) return;
      t.postponedCount += 1;
      // "Not now" is a decision: push it to the end and let manual order stand for a while.
      t.rank = Math.max(...st.tasks.map((x) => x.rank)) + 1;
      save(s, t);
      st.settings.manualOrderAt = now;
      s.touchSettings();
      log(s, now, "you", "human", `You postponed ${lower(t.title)}${t.postponedCount >= 3 ? ` — ${t.postponedCount} times now` : ""}`, t.id);
      return;
    }

    case "procrastination_answer": {
      const t = task(s, action.taskId);
      if (!t || !isOpen(t)) return;
      if (action.choice === "break_down") {
        const step = newTask(
          {
            title: `Break “${t.title}” into 25-minute steps`,
            projectId: t.projectId,
            parentId: t.id,
            mode: "AI",
            automation: 100,
            agent: "operations",
            humanValue: 1,
            priority: t.priority,
            aiMinutes: 6,
            manualMinutes: 20,
            reason: "A vague task becomes three concrete ones. The first step should take less than 25 minutes.",
            tags: ["Breakdown"],
            source: "ai",
            autoRun: true,
          },
          now,
        );
        st.tasks.push(step);
        save(s, step);
        enqueue(s, step, now, { reason: "Breaking down" });
        t.humanMinutes = Math.min(t.humanMinutes || 25, 25);
      } else if (action.choice === "delegate") {
        const a = classifyTask(t.title);
        t.mode = a.agent ? "AI" : "AI_YOU";
        t.agent = a.agent ?? "operations";
        t.automation = a.agent ? 75 : 50;
        t.keptHuman = false;
        t.delegatedAt = now;
        t.aiMinutes = a.aiMinutes || AGENTS[t.agent].aiMinutes;
        t.reason = "You kept postponing it — the AI takes the first pass, you review.";
        save(s, t);
        enqueue(s, t, now, { reason: "Delegated after repeated postponement" });
      } else if (action.choice === "delete") {
        t.status = "cancelled";
        save(s, t);
        log(s, now, "you", "human", `Deleted ${lower(t.title)} — it wasn’t actually important`, t.id);
      }
      t.postponedCount = 0;
      save(s, t);
      if (action.choice === "keep") decide(s, now, "note", `Keep “${t.title}”`, "Postponed several times but still matters.", null, t.projectId, null);
      rerank(s, now);
      return;
    }

    case "focus_project": {
      const p = st.projects.find((x) => x.id === action.projectId);
      if (!p) return;
      const days = Math.max(1, Math.min(14, action.days));
      st.settings.focus = { projectId: p.id, until: now + days * DAY, goal: p.goal, startedAt: now };
      s.touchSettings();
      if (p.parkedUntil) {
        p.parkedUntil = null;
        s.touch("project", p.id);
      }
      decide(s, now, "focus", `Focus ${p.name} for ${days} day${days > 1 ? "s" : ""}`, p.goal ? `Reach: ${p.goal}` : "Finish what matters", p.goal, p.id, now + days * DAY);
      // Shortest path: delegate everything delegable, prepare human steps, generate the AI missions.
      let delegated = 0;
      for (const t of st.tasks) {
        if (t.projectId !== p.id || t.status !== "todo" || t.isMission || t.keptHuman || !t.agent) continue;
        if ((t.mode === "AI" || t.mode === "AI_YOU") && t.risk !== "high" && enqueue(s, t, now)) delegated++;
      }
      for (const t of [...st.tasks]) {
        if (t.projectId === p.id && t.status === "todo" && t.mode === "YOU" && t.aiPrep.length && t.agent && !st.tasks.some((c) => c.parentId === t.id)) createPrep(s, t, now);
      }
      for (const o of st.opportunities.filter((x) => x.projectId === p.id && x.status === "open")) {
        apply(s, { type: "accept_opportunity", opportunityId: o.id }, now, null);
      }
      log(s, now, "system", "system", `Focus mode: ${p.name} — ${delegated} task${delegated === 1 ? "" : "s"} delegated, distractions muted`, null);
      st.settings.manualOrderAt = null;
      rerank(s, now);
      return;
    }

    case "exit_focus": {
      const f = st.settings.focus;
      if (!f) return;
      st.settings.focus = null;
      s.touchSettings();
      for (const d of st.decisions) {
        if (d.kind === "focus" && d.projectId === f.projectId && (!d.until || d.until > now)) {
          d.until = now;
          s.touch("decision", d.id);
        }
      }
      log(s, now, "you", "system", `Focus ended early`, null);
      rerank(s, now);
      return;
    }

    case "set_max_leverage": {
      st.settings.maxLeverage = action.on;
      s.touchSettings();
      log(
        s,
        now,
        "system",
        "system",
        action.on ? "Maximum leverage on — the AI takes, prepares and follows up everything it can" : "Maximum leverage off",
        null,
      );
      rerank(s, now);
      return;
    }

    case "set_context": {
      if (action.energy) st.settings.energy = action.energy;
      if (action.place) st.settings.place = action.place;
      s.touchSettings();
      rerank(s, now);
      return;
    }

    case "build_day": {
      const minutes = Math.max(30, Math.min(12 * 60, action.minutes));
      const sim = simulateDay(st, minutes, now);
      const plan = sim.strategies.find((x) => x.id === action.strategy);
      if (!plan) return;
      // Human schedule: commit flexible blocks to the calendar.
      for (const h of plan.plan.human) {
        const t = task(s, h.task.id);
        if (t && !t.scheduledAt) {
          t.scheduledAt = h.start;
          save(s, t);
        }
      }
      // AI schedule: accept the AI-generated missions it relies on, then run everything in parallel.
      const opps = new Set(plan.plan.ai.filter((a) => a.draft).map((a) => a.draft!.opportunityId));
      for (const oid of opps) apply(s, { type: "accept_opportunity", opportunityId: oid }, now, null);
      for (const a of plan.plan.ai) {
        if (!a.task) continue;
        const t = task(s, a.task.id);
        if (t && t.status === "todo") enqueue(s, t, now, { scheduledFor: a.start > now + 5 * MIN ? a.start : null });
      }
      st.settings.dayPlan = {
        strategy: plan.id,
        createdAt: now,
        minutes,
        blocks: [
          ...plan.plan.human.map((h) => ({ taskId: h.task.id, title: h.task.title, lane: "you" as const, start: h.start, end: h.end, agent: null })),
          ...plan.plan.ai.map((a) => ({ taskId: a.task?.id ?? "", title: a.task?.title ?? a.draft?.title ?? "", lane: "ai" as const, start: a.start, end: a.end, agent: a.agent })),
        ],
      };
      s.touchSettings();
      decide(s, now, "strategy", `${plan.label} day (${fmtDuration(minutes)})`, plan.goal, `${plan.plan.human.length} human missions, ${plan.plan.ai.length} AI missions in parallel`, null, now + DAY);
      log(s, now, "system", "system", `Day built: ${plan.label} — ${plan.plan.human.length} things for you, ${plan.plan.ai.length} for the AI in parallel`, null);
      st.settings.manualOrderAt = null;
      rerank(s, now);
      return;
    }

    case "clear_day_plan": {
      st.settings.dayPlan = null;
      s.touchSettings();
      return;
    }

    case "park_project": {
      const p = st.projects.find((x) => x.id === action.projectId);
      if (!p) return;
      const days = action.days === null ? null : Math.max(1, Math.min(365, action.days));
      parkProject(s, p.id, days, action.reason ?? "Paused by you", now);
      rerank(s, now);
      return;
    }

    case "resume_project": {
      const p = st.projects.find((x) => x.id === action.projectId);
      if (!p || !p.parkedUntil) return;
      p.parkedUntil = null;
      p.lastActivityAt = now; // a fresh start: don't flag it as dead right away
      s.touch("project", p.id);
      for (const d of st.decisions) {
        if (d.kind === "park" && d.projectId === p.id && (!d.until || d.until > now)) {
          d.until = now;
          s.touch("decision", d.id);
        }
      }
      log(s, now, "you", "system", `${p.name} resumed`, null);
      rerank(s, now);
      return;
    }

    case "revive_project": {
      const p = st.projects.find((x) => x.id === action.projectId);
      if (!p) return;
      p.parkedUntil = null;
      p.lastActivityAt = now;
      s.touch("project", p.id);
      decide(s, now, "revive", `Revive ${p.name}`, "Still worth it — restart with a clear next step.", p.goal, p.id, null);
      if (!p.goal) {
        const t = newTask(
          {
            title: `Define the next milestone for ${p.name}`,
            projectId: p.id,
            mode: "YOU",
            humanKind: "decision",
            humanValue: 4,
            priority: "high",
            humanMinutes: 15,
            manualMinutes: 15,
            reason: "A project without a milestone drifts. Decide what “done for now” means.",
            tags: ["Decision"],
            source: "ai",
          },
          now,
        );
        st.tasks.push(t);
        save(s, t);
      }
      log(s, now, "you", "system", `${p.name} revived`, null);
      rerank(s, now);
      return;
    }

    case "apply_triage": {
      const t = portfolioTriage(st, now);
      for (const x of t.park) parkProject(s, x.project.id, 7, x.reason, now);
      decide(
        s,
        now,
        "strategy",
        `Primary: ${t.primary.map((x) => x.project.name).join(" + ")}`,
        t.primary.map((x) => `${x.project.name}: ${x.reason}`).join(" "),
        t.park.length ? `Paused: ${t.park.map((x) => x.project.name).join(", ")}` : null,
        null,
        now + 7 * DAY,
      );
      rerank(s, now);
      return;
    }

    case "tradeoff_answer": {
      const winner = st.projects.find((x) => x.id === action.winnerId);
      const loser = st.projects.find((x) => x.id === action.loserId);
      if (!winner || !loser) return;
      const chosen = action.accepted ? winner : loser;
      const other = action.accepted ? loser : winner;
      decide(
        s,
        now,
        "tradeoff",
        `${chosen.name} over ${other.name} for ${action.days} days`,
        action.accepted ? "Accepted the Chief of Staff’s recommendation." : "Overrode the recommendation.",
        chosen.goal,
        chosen.id,
        now + action.days * DAY,
      );
      apply(s, { type: "focus_project", projectId: chosen.id, days: action.days }, now, null);
      return;
    }

    case "tell": {
      const text = action.text.trim().slice(0, 500);
      if (!text) return;
      const intent = parseIntent(text, st.projects, now, st.settings.tzOffsetMin);
      if (intent.kind === "focus" && intent.projectId) {
        apply(s, { type: "focus_project", projectId: intent.projectId, days: intent.days }, now, null);
      } else if (intent.kind === "park" && intent.projectId) {
        parkProject(s, intent.projectId, intent.days, text, now);
        rerank(s, now);
      } else {
        decide(s, now, "note", text, "Noted from you.", null, intent.projectId, null);
        log(s, now, "you", "system", `Noted: “${text}”`, null);
      }
      return;
    }

    case "automate": {
      const added = action.phrases.map((p) => p.toLowerCase().trim()).filter((p) => p && !st.settings.delegationRules.includes(p));
      st.settings.delegationRules.push(...added);
      s.touchSettings();
      // Open work matching the new rules moves to the AI right away.
      for (const t of st.tasks) {
        if (!isOpen(t) || !t.agent || !t.keptHuman) continue;
        const a = classifyTask(t.title, { delegationRules: added });
        if (a.reason.startsWith("You asked me")) {
          t.keptHuman = false;
          t.mode = "AI";
          save(s, t);
        }
      }
      if (added.length) decide(s, now, "automate", `Always delegate: ${added.join(", ")}`, "Recurring work an agent can own.", null, null, null);
      log(s, now, "system", "system", `Automated ${added.length} recurring task type${added.length === 1 ? "" : "s"}`, null);
      return;
    }

    case "reset": {
      const tz = st.settings?.tzOffsetMin ?? 0;
      s.wipe();
      seed(s, now, tz);
      return;
    }
  }
}

function createPrep(s: Store, human: Task, now: number) {
  const agent: AgentRole = human.humanKind === "call" || human.humanKind === "relationship" ? "content" : "research";
  const label =
    human.humanKind === "call" ? "call brief" : human.humanKind === "meeting" ? "meeting brief" : human.humanKind === "onsite" ? "visit brief" : "brief";
  const prep = newTask(
    {
      title: `Prepare ${label}: ${human.title}`,
      projectId: human.projectId,
      parentId: human.id,
      mode: "AI",
      automation: 100,
      agent,
      risk: "low",
      humanValue: 1,
      priority: human.priority,
      aiMinutes: 8,
      manualMinutes: 40,
      reason: `Prepares ${human.aiPrep.slice(0, 3).join(", ").toLowerCase()} so you walk in ready.`,
      aiPrep: [],
      tags: ["AI prep"],
      source: "ai",
      autoRun: true,
    },
    now,
  );
  s.state.tasks.push(prep);
  save(s, prep);
  enqueue(s, prep, now, { reason: "Preparing" });
}

function decide(
  s: Store,
  now: number,
  kind: Decision["kind"],
  title: string,
  reason: string,
  expected: string | null,
  projectId: string | null,
  until: number | null,
) {
  const d: Decision = { id: id(), at: now, kind, title, reason, expected, projectId, until };
  s.state.decisions.unshift(d);
  s.touch("decision", d.id);
}

function parkProject(s: Store, projectId: string, days: number | null, reason: string, now: number) {
  const p = s.state.projects.find((x) => x.id === projectId);
  if (!p) return;
  p.parkedUntil = now + (days ?? PAUSE_INDEFINITE_DAYS) * DAY;
  s.touch("project", p.id);
  // Stop queued work; running jobs finish.
  for (const j of s.state.jobs) {
    const t = task(s, j.task_id);
    if (j.status === "QUEUED" && t?.projectId === p.id) {
      j.status = "CANCELLED";
      j.completed_at = now;
      s.touch("job", j.id);
      t.status = "todo";
      save(s, t);
    }
  }
  if (s.state.settings.focus?.projectId === p.id) {
    s.state.settings.focus = null;
    s.touchSettings();
  }
  const span = days === null ? "until you resume it" : `for ${days} day${days > 1 ? "s" : ""}`;
  decide(s, now, "park", `Pause ${p.name} ${span}`, reason, null, p.id, days === null ? null : now + days * DAY);
  log(s, now, "system", "system", `${p.name} paused ${span} — out of your head, not lost`, null);
}
