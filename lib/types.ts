// Domain model for the AI Chief of Staff.
// Everything the system knows about work is expressed in these types; the UI
// and the engine never invent fields that are not declared here.

/** WHO executes a task. */
export type ExecutionMode = "YOU" | "AI" | "AI_YOU" | "WAITING";

/** 0 = human only … 100 = fully automatable. */
export type AutomationPotential = 0 | 25 | 50 | 75 | 100;

export type AgentRole =
  | "research"
  | "coding"
  | "design"
  | "content"
  | "operations"
  | "analyst";

/** low: AI runs it alone · medium: AI prepares, you approve · high: approval before AND after. */
export type RiskLevel = "low" | "medium" | "high";

/** How valuable it is for Rémi to personally spend time on this (1 very low … 5 very high). */
export type HumanValue = 1 | 2 | 3 | 4 | 5;

export type Priority = "critical" | "high" | "medium" | "low";

/** What kind of human presence the task needs — drives icon, copy and AI prep. */
export type HumanKind =
  | "call"
  | "meeting"
  | "onsite"
  | "decision"
  | "creative"
  | "relationship"
  | "signature"
  | "review"
  | "generic";

export type TaskStatus =
  | "todo" // not started; for AI tasks: suggested, not yet queued
  | "ai_queued"
  | "ai_running"
  | "awaiting_approval" // AI finished (or wants to start) and needs a human OK
  | "your_turn" // AI prep complete → human decision/action
  | "waiting" // blocked by someone external
  | "done"
  | "cancelled";

export type TaskSource = "user" | "ai";

export interface Task {
  id: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  notes: string | null;

  mode: ExecutionMode;
  automation: AutomationPotential;
  agent: AgentRole | null;
  risk: RiskLevel;
  humanValue: HumanValue;
  priority: Priority;
  humanKind: HumanKind | null;

  /** Minutes Rémi personally has to spend. */
  humanMinutes: number;
  /** Minutes the AI needs to execute its part. */
  aiMinutes: number;
  /** Minutes it would take Rémi to do the whole thing by hand (basis of "time saved"). */
  manualMinutes: number;

  status: TaskStatus;
  reason: string;
  aiPrep: string[];
  tags: string[];

  waitingOn: string | null;
  followUpAt: number | null;
  scheduledAt: number | null;
  location: string | null;

  dependsOn: string[];
  source: TaskSource;
  /** Lower = more important. Rewritten by the Chief of Staff on every analysis. */
  rank: number;
  /** True when the user forced an AI-capable task onto themselves. */
  keptHuman: boolean;
  /** Part of a plan the user already accepted: AI steps start as soon as they unlock. */
  autoRun: boolean;
  /** A mission groups a chain of human + AI steps (children point to it via parentId). */
  isMission: boolean;
  /** How many times Rémi pushed it back ("Not now") — procrastination signal. */
  postponedCount: number;
  /** Minutes Rémi actually spent (measured from Start → Done when available). */
  actualHumanMinutes: number | null;

  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  delegatedAt: number | null;
  unlockedAt: number | null;
  handoffAt: number | null;
  unlockedBy: string | null;
}

export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";

export type Executor = "simulated" | "claude";

/** Mirrors the `agent_jobs` table (db/schema.sql). */
export interface AgentJob {
  id: string;
  task_id: string;
  agent: AgentRole;
  status: JobStatus;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  error: string | null;
  artifacts: string[];
  human_approval_required: boolean;
  created_at: number;
  // execution bookkeeping
  progress: number; // 0..1
  current_step: string | null;
  executor: Executor;
  est_duration_ms: number;
  scheduled_for: number | null;
  /** "before": approval needed to start (high risk). "after": approval needed to apply the result. */
  approval_stage: "before" | "after" | null;
  saved_minutes: number;
}

export type ProjectHealth = "on_track" | "at_risk" | "attention" | "idle";
export type ProjectStage = "idea" | "building" | "deployed" | "shipped";
/** client: paid work · product: something Rémi is building · side: exploratory. */
export type ProjectKind = "client" | "product" | "side";

export interface Project {
  id: string;
  name: string;
  color: string;
  description: string;
  stage: ProjectStage;
  health: ProjectHealth;
  healthChangedAt: number | null;
  progress: number; // 0..1, derived from tasks
  /** Work finished before it was tracked here — keeps progress honest for older projects. */
  legacyDone: number;
  lastActivityAt: number;
  kind: ProjectKind;
  /** 1–5: how much this project matters for Rémi's direction (portfolio, positioning). */
  strategicValue: number;
  /** 1–5: how directly it can turn into money or clients. */
  revenuePotential: number;
  /** The next meaningful milestone, in plain words. null = undefined milestone (a warning sign). */
  goal: string | null;
  deadline: number | null;
  /** Parked projects are kept out of recommendations until `parkedUntil`. */
  parkedUntil: number | null;
}

export interface TaskDraft {
  title: string;
  mode?: ExecutionMode;
  agent?: AgentRole | null;
  humanKind?: HumanKind | null;
  tags?: string[];
  /** Index (inside the same draft list) of tasks this one depends on. */
  after?: number[];
  risk?: RiskLevel;
}

export interface Opportunity {
  id: string;
  key: string; // dedupe key: one opportunity per (rule, project)
  projectId: string | null;
  title: string;
  summary: string;
  drafts: TaskDraft[];
  status: "open" | "accepted" | "dismissed";
  createdAt: number;
}

export type ActivityKind =
  | "start"
  | "progress"
  | "complete"
  | "discover"
  | "approval"
  | "handoff"
  | "unlock"
  | "human"
  | "system"
  | "fail";

export interface Activity {
  id: string;
  at: number;
  actor: AgentRole | "you" | "system";
  kind: ActivityKind;
  text: string;
  taskId: string | null;
}

export type Energy = "high" | "medium" | "low";
export type Place = "desk" | "on_the_go" | "out";

export interface FocusState {
  projectId: string;
  until: number;
  goal: string | null;
  startedAt: number;
}

export interface DayPlanBlock {
  taskId: string;
  title: string;
  lane: "you" | "ai";
  start: number;
  end: number;
  agent: AgentRole | null;
}

export interface DayPlan {
  strategy: StrategyId;
  createdAt: number;
  minutes: number;
  blocks: DayPlanBlock[];
}

export type StrategyId = "finish" | "build" | "revenue" | "balanced";

export interface Settings {
  autopilot: boolean;
  /** MAXIMUM LEVERAGE: delegate, prepare and follow up everything the AI can; keep only high-leverage human work. */
  maxLeverage: boolean;
  energy: Energy;
  place: Place;
  focus: FocusState | null;
  dayPlan: DayPlan | null;
  /** Daily snapshots of workflow efficiency, newest last (for "dropped from 91 → 87"). */
  efficiencyHistory: { day: number; score: number }[];
  /** Last time Rémi reordered his own list by hand — automatic re-ranking backs off for a while. */
  manualOrderAt?: number | null;
  /** Real seconds per AI-minute for simulated jobs (demo speed). */
  simSecondsPerMinute: number;
  /** Local minutes-of-day. */
  dayStartMin: number;
  dayEndMin: number;
  /** Client timezone offset (Date#getTimezoneOffset) captured at seed time. */
  tzOffsetMin: number;
  userName: string;
  /** Lower-cased phrases the user asked to always delegate. */
  delegationRules: string[];
  lastAnalysisAt: number | null;
  dayUpdate: { at: number; message: string } | null;
  delegationPrompt: {
    taskId: string;
    title: string;
    spentMinutes: number;
    aiMinutes: number;
    phrase: string;
  } | null;
}

export type DecisionKind = "focus" | "tradeoff" | "park" | "revive" | "strategy" | "automate" | "note" | "postpone";

/** Strategic memory: things Rémi decided, so the system stops re-asking. */
export interface Decision {
  id: string;
  at: number;
  kind: DecisionKind;
  title: string;
  reason: string;
  expected: string | null;
  projectId: string | null;
  /** Decisions stop influencing recommendations after this time. */
  until: number | null;
}

export interface WorkspaceState {
  now: number;
  projects: Project[];
  tasks: Task[];
  jobs: AgentJob[];
  activity: Activity[];
  opportunities: Opportunity[];
  decisions: Decision[];
  settings: Settings;
  claudeEnabled: boolean;
}

/** Output of the classifier — what the Chief of Staff thinks about a task. */
export interface TaskAnalysis {
  mode: ExecutionMode;
  automation: AutomationPotential;
  agent: AgentRole | null;
  risk: RiskLevel;
  humanValue: HumanValue;
  priority: Priority;
  humanKind: HumanKind | null;
  humanMinutes: number;
  aiMinutes: number;
  manualMinutes: number;
  reason: string;
  /** What AI can prepare when the task itself is human. */
  aiPrep: string[];
  tags: string[];
  waitingOn: string | null;
  /** Non-empty when the task should be split into a human+AI chain. */
  mission: TaskDraft[];
  source: "heuristic" | "claude";
}

export type Action =
  | { type: "create_task"; title: string; projectId: string | null; intent: "run" | "schedule" | "me" | "auto" }
  | { type: "run_task"; taskId: string }
  | { type: "run_all"; taskIds: string[] }
  | { type: "delegate"; taskId: string }
  | { type: "assign_me"; taskId: string }
  | { type: "start_task"; taskId: string }
  | { type: "complete_task"; taskId: string }
  | { type: "approve_job"; jobId: string }
  | { type: "reject_job"; jobId: string }
  | { type: "cancel_job"; jobId: string }
  | { type: "retry_job"; jobId: string }
  | { type: "accept_opportunity"; opportunityId: string; include?: number[] }
  | { type: "dismiss_opportunity"; opportunityId: string }
  | { type: "set_autopilot"; on: boolean }
  | { type: "analyze" }
  | { type: "reorder"; taskIds: string[] }
  | { type: "delegation_answer"; yes: boolean }
  | { type: "dismiss_day_update" }
  | { type: "postpone"; taskId: string }
  | { type: "procrastination_answer"; taskId: string; choice: "break_down" | "delegate" | "delete" | "keep" }
  | { type: "focus_project"; projectId: string; days: number }
  | { type: "exit_focus" }
  | { type: "set_max_leverage"; on: boolean }
  | { type: "set_context"; energy?: Energy; place?: Place }
  | { type: "build_day"; strategy: StrategyId; minutes: number }
  | { type: "clear_day_plan" }
  /** days: null = paused until Rémi resumes it. */
  | { type: "park_project"; projectId: string; days: number | null; reason?: string }
  | { type: "resume_project"; projectId: string }
  | { type: "revive_project"; projectId: string }
  | { type: "apply_triage" }
  | { type: "tradeoff_answer"; winnerId: string; loserId: string; accepted: boolean; days: number }
  | { type: "tell"; text: string }
  | { type: "automate"; phrases: string[] }
  | { type: "reset" };
