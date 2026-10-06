-- Dash — AI Chief of Staff workspace schema (SQLite).
-- Columns that the engine filters on are real columns; the full domain object
-- is kept in `data` (JSON) so the model can evolve without migrations.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  stage             TEXT NOT NULL CHECK (stage IN ('idea','building','deployed','shipped')),
  health            TEXT NOT NULL CHECK (health IN ('on_track','at_risk','attention','idle')),
  last_activity_at  INTEGER NOT NULL,
  data              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id     TEXT,
  title         TEXT NOT NULL,
  -- WHO executes it
  mode          TEXT NOT NULL CHECK (mode IN ('YOU','AI','AI_YOU','WAITING')),
  automation    INTEGER NOT NULL CHECK (automation IN (0,25,50,75,100)),
  agent         TEXT CHECK (agent IN ('research','coding','design','content','operations','analyst')),
  risk          TEXT NOT NULL CHECK (risk IN ('low','medium','high')),
  human_value   INTEGER NOT NULL CHECK (human_value BETWEEN 1 AND 5),
  priority      TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')),
  status        TEXT NOT NULL,
  rank          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);

-- One row per agent execution attempt.
CREATE TABLE IF NOT EXISTS agent_jobs (
  id                       TEXT PRIMARY KEY,
  task_id                  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent                    TEXT NOT NULL CHECK (agent IN ('research','coding','design','content','operations','analyst')),
  status                   TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','WAITING_FOR_APPROVAL','COMPLETED','FAILED','BLOCKED','CANCELLED')),
  started_at               INTEGER,
  completed_at             INTEGER,
  result                   TEXT,
  error                    TEXT,
  artifacts                TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  human_approval_required  INTEGER NOT NULL DEFAULT 0,   -- boolean
  created_at               INTEGER NOT NULL,
  -- execution bookkeeping
  progress                 REAL NOT NULL DEFAULT 0,
  current_step             TEXT,
  executor                 TEXT NOT NULL DEFAULT 'simulated' CHECK (executor IN ('simulated','claude')),
  est_duration_ms          INTEGER NOT NULL DEFAULT 0,
  scheduled_for            INTEGER,
  approval_stage           TEXT CHECK (approval_stage IN ('before','after')),
  saved_minutes            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS agent_jobs_status ON agent_jobs(status);
CREATE INDEX IF NOT EXISTS agent_jobs_task ON agent_jobs(task_id);

CREATE TABLE IF NOT EXISTS activity (
  id       TEXT PRIMARY KEY,
  at       INTEGER NOT NULL,
  actor    TEXT NOT NULL,
  kind     TEXT NOT NULL,
  text     TEXT NOT NULL,
  task_id  TEXT
);
CREATE INDEX IF NOT EXISTS activity_at ON activity(at);

CREATE TABLE IF NOT EXISTS opportunities (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  project_id  TEXT,
  status      TEXT NOT NULL CHECK (status IN ('open','accepted','dismissed')),
  created_at  INTEGER NOT NULL,
  data        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  data  TEXT NOT NULL
);
