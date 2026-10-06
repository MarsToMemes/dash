import { test } from "node:test";
import assert from "node:assert/strict";
import { nextMove, pipelineStage, planDay, rankTasks, timeSaved, todayAt, localMinuteOfDay } from "../lib/planner.ts";
import type { AgentJob, Settings, Task } from "../lib/types.ts";

const NOW = Date.UTC(2026, 9, 6, 9, 0); // 11:00 in Paris (UTC+2)
const TZ = -120;

function t(partial: Partial<Task>): Task {
  return {
    id: Math.random().toString(36).slice(2), projectId: null, parentId: null, title: "x", notes: null,
    mode: "YOU", automation: 0, agent: null, risk: "low", humanValue: 3, priority: "medium", humanKind: "generic",
    humanMinutes: 15, aiMinutes: 0, manualMinutes: 15, status: "todo", reason: "", aiPrep: [], tags: [],
    waitingOn: null, followUpAt: null, scheduledAt: null, location: null, dependsOn: [], source: "user", rank: 0,
    keptHuman: false, autoRun: false, isMission: false, createdAt: NOW, startedAt: null, completedAt: null,
    delegatedAt: null, unlockedAt: null, handoffAt: null, unlockedBy: null, ...partial,
  };
}

const settings: Settings = {
  autopilot: false, simSecondsPerMinute: 3, dayStartMin: 540, dayEndMin: 1140, tzOffsetMin: TZ, userName: "Rémi",
  delegationRules: [], lastAnalysisAt: null, dayUpdate: null, delegationPrompt: null,
};

test("timezone helpers round-trip local time", () => {
  assert.equal(localMinuteOfDay(NOW, TZ), 11 * 60);
  assert.equal(todayAt(NOW, TZ, 14 * 60), Date.UTC(2026, 9, 6, 12, 0));
});

test("an imminent high-value call beats a low-value chore", () => {
  const chore = t({ title: "Tidy desk", humanValue: 2 });
  const call = t({ title: "Call client", humanValue: 5, priority: "high", scheduledAt: NOW + 30 * 60_000 });
  const ranks = rankTasks([chore, call], NOW);
  assert.ok(ranks.get(call.id)! < ranks.get(chore.id)!);
  for (const x of [chore, call]) x.rank = ranks.get(x.id)!;
  assert.equal(nextMove({ tasks: [chore, call] }, NOW)?.id, call.id);
});

test("AI tasks and blocked tasks are never the human next move", () => {
  const ai = t({ mode: "AI", agent: "research", humanValue: 1 });
  const dep = t({ title: "dep", mode: "AI", status: "ai_running" });
  const blocked = t({ title: "blocked", humanValue: 5, dependsOn: [dep.id] });
  assert.equal(nextMove({ tasks: [ai, dep, blocked] }, NOW), null);
});

test("time saved only counts completed jobs in range", () => {
  const base: Omit<AgentJob, "id" | "status" | "completed_at" | "saved_minutes"> = {
    task_id: "x", agent: "research", started_at: 0, result: null, error: null, artifacts: [], human_approval_required: false,
    created_at: 0, progress: 1, current_step: null, executor: "simulated", est_duration_ms: 0, scheduled_for: null, approval_stage: null,
  };
  const jobs: AgentJob[] = [
    { ...base, id: "a", status: "COMPLETED", completed_at: NOW - 1000, saved_minutes: 60 },
    { ...base, id: "b", status: "COMPLETED", completed_at: NOW - 10 * 86_400_000, saved_minutes: 999 },
    { ...base, id: "c", status: "RUNNING", completed_at: null, saved_minutes: 50 },
  ];
  assert.deepEqual(timeSaved(jobs, NOW - 86_400_000), { minutes: 60, count: 1 });
});

test("day plan keeps fixed meetings and fits flexible work around them", () => {
  const meeting = t({ title: "Meeting", scheduledAt: NOW + 30 * 60_000, humanMinutes: 45 });
  const decide = t({ title: "Decide", humanMinutes: 20 });
  const slots = planDay({ tasks: [meeting, decide], jobs: [], settings }, NOW);
  const m = slots.find((s) => s.task.id === meeting.id)!;
  const d = slots.find((s) => s.task.id === decide.id)!;
  assert.ok(m.fixed);
  assert.ok(d.end <= m.start || d.start >= m.end, "flexible slot must not overlap the meeting");
});

test("pipeline stage follows the human + AI chain", () => {
  assert.equal(pipelineStage([t({ mode: "AI", status: "ai_running" }), t({ mode: "YOU" })]), "AI PREP");
  assert.equal(pipelineStage([t({ mode: "AI", status: "done" }), t({ mode: "AI_YOU", status: "your_turn" })]), "HUMAN REVIEW");
  assert.equal(pipelineStage([t({ mode: "AI", status: "done" }), t({ mode: "YOU", humanKind: "call" })]), "HUMAN ACTION");
  assert.equal(pipelineStage([t({ status: "done" })]), "DONE");
});
