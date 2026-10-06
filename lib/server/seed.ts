import "server-only";
import { randomUUID } from "node:crypto";
import { classifyTask } from "../classifier.ts";
import { localMinuteOfDay, todayAt } from "../planner.ts";
import type { Activity, AgentJob, AgentRole, Project, Settings, Task } from "../types.ts";
import type { Store } from "./db.ts";
import { newTask } from "./engine.ts";

// Demo workspace for Rémi. Times are relative to "now" so the dashboard is
// always alive when opened: agents mid-run, a call coming up, a meeting later.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const uid = () => randomUUID().slice(0, 12);

export function seed(s: Store, now: number, tzOffsetMin: number) {
  const nowMin = localMinuteOfDay(now, tzOffsetMin);
  const settings: Settings = {
    autopilot: false,
    simSecondsPerMinute: 3,
    dayStartMin: 9 * 60,
    // Keep a meaningful working window even when the demo is opened late.
    dayEndMin: Math.min(23 * 60 + 45, Math.max(19 * 60, nowMin + 5 * 60)),
    tzOffsetMin,
    userName: "Rémi",
    delegationRules: [],
    lastAnalysisAt: null,
    dayUpdate: null,
    delegationPrompt: null,
  };
  s.state.settings = settings;
  s.touchSettings();

  const round5 = (t: number) => Math.ceil(t / (5 * MIN)) * (5 * MIN);
  const tomorrowAt = (h: number, m = 0) => todayAt(now + DAY, tzOffsetMin, h * 60 + m);

  const projects: Project[] = [
    project("pp", "Patrick Pons", "#4f8cff", "Website redesign for a Paris motorcycle dealer", "building", 28, now - 1 * HOUR),
    project("jobsy", "Jobsy", "#a78bfa", "Job-matching SaaS — design and front-end", "building", 9, now - 1 * DAY),
    project("kopi", "Kopi", "#2dd4bf", "Specialty coffee e-shop, launched last week", "deployed", 18, now - 2 * DAY),
    project("aive", "AI Video Editor", "#fb7185", "Side project: AI-assisted video editing tool", "building", 6, now - 6 * DAY),
    project("plug", "Plug Leak", "#94a3b8", "Small Chrome extension, maintenance only", "shipped", 12, now - 12 * DAY),
  ];
  for (const p of projects) {
    s.state.projects.push(p);
    s.touch("project", p.id);
  }

  const tasks: Task[] = [];
  const jobs: AgentJob[] = [];
  const add = (title: string, extra: Partial<Task> = {}) => {
    const a = classifyTask(title);
    const t = newTask(
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
        createdAt: now - 2 * DAY,
        ...extra,
      },
      now,
    );
    tasks.push(t);
    return t;
  };
  const job = (t: Task, status: AgentJob["status"], extra: Partial<AgentJob> = {}) => {
    const j: AgentJob = {
      id: uid(),
      task_id: t.id,
      agent: (t.agent ?? "operations") as AgentRole,
      status,
      started_at: null,
      completed_at: null,
      result: null,
      error: null,
      artifacts: [],
      human_approval_required: t.risk !== "low",
      created_at: now - 30 * MIN,
      progress: 0,
      current_step: null,
      executor: "simulated",
      est_duration_ms: Math.max(1, t.aiMinutes) * settings.simSecondsPerMinute * 1000,
      scheduled_for: null,
      approval_stage: null,
      saved_minutes: 0,
      ...extra,
    };
    jobs.push(j);
    return j;
  };

  // ---- Patrick Pons -------------------------------------------------------
  const call = add("Call Patrick Pons", {
    projectId: "pp",
    humanMinutes: 10,
    scheduledAt: round5(now + 35 * MIN),
    priority: "high",
    notes: "Confirm the product page structure and get a date for the catalog.",
  });
  const callPrep = add("Prepare call brief: Call Patrick Pons", {
    projectId: "pp",
    parentId: call.id,
    mode: "AI",
    automation: 100,
    agent: "content",
    humanValue: 1,
    aiMinutes: 8,
    manualMinutes: 40,
    humanMinutes: 0,
    humanKind: null,
    reason: "Prepares talking points, likely objections and a call script so you walk in ready.",
    tags: ["AI prep"],
    aiPrep: [],
    source: "ai",
    autoRun: true,
  });
  callPrep.status = "ai_running";
  job(callPrep, "RUNNING", { started_at: now - 6 * settings.simSecondsPerMinute * 1000, progress: 0.7, current_step: "Drafting" });

  const approve = add("Approve Patrick Pons visual direction", {
    projectId: "pp",
    mode: "AI_YOU",
    agent: "design",
    humanKind: "decision",
    humanMinutes: 15,
    humanValue: 4,
    priority: "high",
    status: "your_turn",
    handoffAt: now - 40 * MIN,
    reason: "AI prepared 3 homepage concepts → you pick the direction.",
    aiPrep: ["3 homepage concepts", "References", "Trade-offs"],
  });
  job(approve, "COMPLETED", {
    started_at: now - 3 * HOUR,
    completed_at: now - 40 * MIN,
    progress: 1,
    saved_minutes: 105,
    result: "**Design Agent — 3 homepage concepts**\n\n1. *Garage* — dark, editorial, big photography.\n2. *Track* — motion-led, red accents, product first.\n3. *Showroom* — light, catalogue grid, dealer services up front.\n\nRecommendation: **Showroom** — it puts the catalogue and services where repeat buyers look first.",
    artifacts: ["homepage-concepts.fig"],
  });

  const competitors = add("Analyze Patrick Pons competitors", { projectId: "pp", priority: "medium" });
  competitors.status = "ai_running";
  job(competitors, "RUNNING", {
    started_at: now - Math.round(competitors.aiMinutes * 0.45) * settings.simSecondsPerMinute * 1000,
    progress: 0.45,
    current_step: "Reading sources",
  });

  const components = add("Generate product page components", { projectId: "pp", priority: "high" });
  components.status = "ai_running";
  job(components, "RUNNING", {
    started_at: now - Math.round(components.aiMinutes * 0.62) * settings.simSecondsPerMinute * 1000,
    progress: 0.62,
    current_step: "Writing changes",
  });

  add("Audit mobile responsiveness", { projectId: "pp", dependsOn: [components.id], autoRun: true, tags: ["QA", "Code"] });
  add("Optimize product images", { projectId: "pp" });
  add("Waiting for Patrick Pons to send the product catalog", {
    projectId: "pp",
    waitingOn: "Patrick Pons",
    followUpAt: tomorrowAt(9, 30),
    createdAt: now - 1 * DAY,
  });
  add("Visit motorcycle showroom", { projectId: "pp", humanMinutes: 90, location: "Paris 15e", scheduledAt: tomorrowAt(10) });

  // ---- Jobsy --------------------------------------------------------------
  const meet = add("Meet potential Jobsy client", {
    projectId: "jobsy",
    humanMinutes: 45,
    location: "Paris 9e",
    scheduledAt: round5(now + 2.5 * HOUR),
    priority: "high",
  });
  const meetPrep = add("Prepare meeting brief: Meet potential Jobsy client", {
    projectId: "jobsy",
    parentId: meet.id,
    mode: "AI",
    automation: 100,
    agent: "research",
    humanValue: 1,
    aiMinutes: 8,
    manualMinutes: 40,
    humanMinutes: 0,
    humanKind: null,
    reason: "Researches the company and attendees, drafts an agenda and questions.",
    tags: ["AI prep"],
    aiPrep: [],
    source: "ai",
    autoRun: true,
  });
  meetPrep.status = "ai_queued";
  job(meetPrep, "QUEUED", { created_at: now - 20 * MIN });

  const jobsyComp = add("Make a competitive analysis for Jobsy", { projectId: "jobsy" });
  jobsyComp.status = "ai_queued";
  job(jobsyComp, "QUEUED", { created_at: now - 10 * MIN });
  add("Clean up Jobsy task backlog", { projectId: "jobsy", priority: "low" });
  add("Prepare 15 outreach prospects", { projectId: null });

  // ---- Kopi ---------------------------------------------------------------
  add("Waiting for Kopi brand photography", {
    projectId: "kopi",
    waitingOn: "Kopi",
    createdAt: now - 4 * DAY,
    followUpAt: now - MIN, // overdue: the AI drafts a follow-up on first load
  });
  add("Create 3 Kopi label concepts", { projectId: "kopi" });
  add("Draft Kopi launch newsletter", { projectId: "kopi" });

  // ---- AI Video Editor ------------------------------------------------------
  add("Fix AI Video Editor export bug", { projectId: "aive", createdAt: now - 6 * DAY });
  add("Decide AI Video Editor roadmap", { projectId: "aive", createdAt: now - 6 * DAY, humanMinutes: 30 });

  // ---- Studio -------------------------------------------------------------
  add("Audit your portfolio website", { projectId: null });

  // ---- History: what the AI already did this week ---------------------------
  const history: [string, string | null, number][] = [
    ["Audit Patrick Pons current site", "pp", 4.2],
    ["Collect motorcycle dealer references", "pp", 3.9],
    ["Generate Patrick Pons sitemap", "pp", 3.1],
    ["Draft Patrick Pons homepage copy", "pp", 2.2],
    ["Build header and navigation components", "pp", 1.8],
    ["Write product page SEO metadata", "pp", 1.1],
    ["Check broken links on the legacy site", "pp", 0.9],
    ["Research job board pricing models", "jobsy", 3.4],
    ["Summarize Kopi customer interviews", "kopi", 2.9],
    ["Organize Kopi brand files", "kopi", 2.1],
    ["Draft Jobsy onboarding emails", "jobsy", 1.3],
    ["Analyze Kopi launch-week metrics", "kopi", 0.12],
  ];
  for (const [title, projectId, daysAgo] of history) {
    const done = now - daysAgo * DAY;
    const t = add(title, { projectId, status: "done", completedAt: done, createdAt: done - 2 * HOUR, source: "user" });
    if (t.mode === "YOU") t.mode = "AI";
    job(t, "COMPLETED", {
      started_at: done - t.aiMinutes * MIN,
      completed_at: done,
      progress: 1,
      saved_minutes: Math.max(0, t.manualMinutes - t.humanMinutes),
      artifacts: [`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`],
      result: `**${title}** — delivered.`,
    });
  }
  const humanHistory: [string, string, number][] = [
    ["Kick-off call with Patrick Pons", "pp", 4.5],
    ["Choose Patrick Pons typography", "pp", 2.6],
    ["Present Kopi launch plan to the founders", "kopi", 5.1],
  ];
  for (const [title, projectId, daysAgo] of humanHistory) {
    const done = now - daysAgo * DAY;
    add(title, { projectId, status: "done", completedAt: done, createdAt: done - DAY });
  }

  // Deliberately in creation order, not ranked: the first analysis on load
  // visibly reorganises the day and lifts the real next move to the top.
  tasks.forEach((t, i) => (t.rank = tasks.length - i));

  for (const t of tasks) {
    s.state.tasks.push(t);
    s.touch("task", t.id);
  }
  for (const j of jobs) {
    s.state.jobs.push(j);
    s.touch("job", j.id);
  }

  const feed: [number, Activity["actor"], Activity["kind"], string, string | null][] = [
    [now - 3 * HOUR, "design", "start", "Design Agent started 3 homepage concepts for Patrick Pons", approve.id],
    [now - 40 * MIN, "design", "handoff", "AI preparation complete — your turn: Approve Patrick Pons visual direction", approve.id],
    [now - 22 * MIN, "coding", "start", "Coding Agent started generate product page components", components.id],
    [now - 14 * MIN, "research", "start", "Research Agent started analyze Patrick Pons competitors", competitors.id],
    [now - 9 * MIN, "research", "progress", "Found 12 competitors — Analyze Patrick Pons competitors", competitors.id],
    [now - 6 * MIN, "content", "start", "Content Agent started preparing your call brief for Patrick Pons", callPrep.id],
  ];
  for (const [at, actor, kind, text, taskId] of feed) {
    const a: Activity = { id: uid(), at, actor, kind, text, taskId };
    s.state.activity.push(a);
    s.touchActivity(a);
  }
  s.state.activity.sort((a, b) => b.at - a.at);
}

function project(
  id: string,
  name: string,
  color: string,
  description: string,
  stage: Project["stage"],
  legacyDone: number,
  lastActivityAt: number,
): Project {
  return { id, name, color, description, stage, health: "on_track", healthChangedAt: null, progress: 0, legacyDone, lastActivityAt };
}
