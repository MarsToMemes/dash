import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Activity, AgentJob, Opportunity, Project, Settings, Task, WorkspaceState } from "../types.ts";

// The workspace lives in memory (single process) and is written through to
// SQLite at the end of every request. Mutations mark entities dirty; flush()
// persists them in one transaction.

const DB_PATH = process.env.DASH_DB_PATH ?? path.join(process.cwd(), "data", "dash.db");

export interface Store {
  state: Omit<WorkspaceState, "now" | "claudeEnabled">;
  touch(kind: "project" | "task" | "job" | "opportunity", id: string): void;
  touchActivity(a: Activity): void;
  touchSettings(): void;
  flush(): void;
  wipe(): void;
}

type Row = Record<string, unknown>;

function open(): DatabaseSync {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  return db;
}

function jobFromRow(r: Row): AgentJob {
  return {
    id: r.id as string,
    task_id: r.task_id as string,
    agent: r.agent as AgentJob["agent"],
    status: r.status as AgentJob["status"],
    started_at: (r.started_at as number | null) ?? null,
    completed_at: (r.completed_at as number | null) ?? null,
    result: (r.result as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    artifacts: JSON.parse((r.artifacts as string) || "[]"),
    human_approval_required: Boolean(r.human_approval_required),
    created_at: r.created_at as number,
    progress: r.progress as number,
    current_step: (r.current_step as string | null) ?? null,
    executor: r.executor as AgentJob["executor"],
    est_duration_ms: r.est_duration_ms as number,
    scheduled_for: (r.scheduled_for as number | null) ?? null,
    approval_stage: (r.approval_stage as AgentJob["approval_stage"]) ?? null,
    saved_minutes: r.saved_minutes as number,
  };
}

function load(db: DatabaseSync): Store["state"] | null {
  const settingsRow = db.prepare("SELECT data FROM settings WHERE id = 1").get() as Row | undefined;
  if (!settingsRow) return null;
  return {
    settings: JSON.parse(settingsRow.data as string) as Settings,
    projects: (db.prepare("SELECT data FROM projects").all() as Row[]).map((r) => JSON.parse(r.data as string) as Project),
    tasks: (db.prepare("SELECT data FROM tasks").all() as Row[]).map((r) => JSON.parse(r.data as string) as Task),
    jobs: (db.prepare("SELECT * FROM agent_jobs").all() as Row[]).map(jobFromRow),
    activity: (db.prepare("SELECT * FROM activity ORDER BY at DESC LIMIT 200").all() as Row[]).map((r) => ({
      id: r.id as string,
      at: r.at as number,
      actor: r.actor as Activity["actor"],
      kind: r.kind as Activity["kind"],
      text: r.text as string,
      taskId: (r.task_id as string | null) ?? null,
    })),
    opportunities: (db.prepare("SELECT data FROM opportunities").all() as Row[]).map((r) => JSON.parse(r.data as string) as Opportunity),
  };
}

function createStore(): Store {
  const db = open();
  const empty: Store["state"] = {
    settings: null as unknown as Settings,
    projects: [],
    tasks: [],
    jobs: [],
    activity: [],
    opportunities: [],
  };
  const state = load(db) ?? empty;
  const dirty = { project: new Set<string>(), task: new Set<string>(), job: new Set<string>(), opportunity: new Set<string>() };
  let dirtyActivity: Activity[] = [];
  let dirtySettings = false;

  const upsertProject = db.prepare(
    `INSERT INTO projects (id, name, stage, health, last_activity_at, data) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, stage=excluded.stage, health=excluded.health,
       last_activity_at=excluded.last_activity_at, data=excluded.data`,
  );
  const upsertTask = db.prepare(
    `INSERT INTO tasks (id, project_id, parent_id, title, mode, automation, agent, risk, human_value, priority, status, rank, created_at, completed_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, parent_id=excluded.parent_id, title=excluded.title,
       mode=excluded.mode, automation=excluded.automation, agent=excluded.agent, risk=excluded.risk,
       human_value=excluded.human_value, priority=excluded.priority, status=excluded.status, rank=excluded.rank,
       completed_at=excluded.completed_at, data=excluded.data`,
  );
  const upsertJob = db.prepare(
    `INSERT INTO agent_jobs (id, task_id, agent, status, started_at, completed_at, result, error, artifacts,
       human_approval_required, created_at, progress, current_step, executor, est_duration_ms, scheduled_for, approval_stage, saved_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, started_at=excluded.started_at, completed_at=excluded.completed_at,
       result=excluded.result, error=excluded.error, artifacts=excluded.artifacts,
       human_approval_required=excluded.human_approval_required, progress=excluded.progress,
       current_step=excluded.current_step, executor=excluded.executor, est_duration_ms=excluded.est_duration_ms,
       scheduled_for=excluded.scheduled_for, approval_stage=excluded.approval_stage, saved_minutes=excluded.saved_minutes`,
  );
  const insertActivity = db.prepare("INSERT OR IGNORE INTO activity (id, at, actor, kind, text, task_id) VALUES (?, ?, ?, ?, ?, ?)");
  const upsertOpp = db.prepare(
    `INSERT INTO opportunities (id, key, project_id, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data`,
  );
  const upsertSettings = db.prepare(
    "INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
  );

  return {
    state,
    touch(kind, id) {
      dirty[kind].add(id);
    },
    touchActivity(a) {
      dirtyActivity.push(a);
    },
    touchSettings() {
      dirtySettings = true;
    },
    flush() {
      db.exec("BEGIN");
      try {
        // Projects before tasks before jobs: foreign keys.
        for (const id of dirty.project) {
          const p = state.projects.find((x) => x.id === id);
          if (p) upsertProject.run(p.id, p.name, p.stage, p.health, p.lastActivityAt, JSON.stringify(p));
        }
        for (const id of dirty.task) {
          const t = state.tasks.find((x) => x.id === id);
          if (t)
            upsertTask.run(t.id, t.projectId, t.parentId, t.title, t.mode, t.automation, t.agent, t.risk, t.humanValue,
              t.priority, t.status, t.rank, t.createdAt, t.completedAt, JSON.stringify(t));
        }
        for (const id of dirty.job) {
          const j = state.jobs.find((x) => x.id === id);
          if (j)
            upsertJob.run(j.id, j.task_id, j.agent, j.status, j.started_at, j.completed_at, j.result, j.error,
              JSON.stringify(j.artifacts), j.human_approval_required ? 1 : 0, j.created_at, j.progress, j.current_step,
              j.executor, j.est_duration_ms, j.scheduled_for, j.approval_stage, j.saved_minutes);
        }
        for (const id of dirty.opportunity) {
          const o = state.opportunities.find((x) => x.id === id);
          if (o) upsertOpp.run(o.id, o.key, o.projectId, o.status, o.createdAt, JSON.stringify(o));
        }
        for (const a of dirtyActivity) insertActivity.run(a.id, a.at, a.actor, a.kind, a.text, a.taskId);
        if (dirtySettings) upsertSettings.run(JSON.stringify(state.settings));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      for (const set of Object.values(dirty)) set.clear();
      dirtyActivity = [];
      dirtySettings = false;
    },
    wipe() {
      db.exec("DELETE FROM activity; DELETE FROM agent_jobs; DELETE FROM tasks; DELETE FROM opportunities; DELETE FROM projects; DELETE FROM settings;");
      state.projects = [];
      state.tasks = [];
      state.jobs = [];
      state.activity = [];
      state.opportunities = [];
      state.settings = null as unknown as Settings;
    },
  };
}

// Survive dev hot-reloads.
const g = globalThis as unknown as { __dashStore?: Store };
export function getStore(): Store {
  if (!g.__dashStore) g.__dashStore = createStore();
  return g.__dashStore;
}
