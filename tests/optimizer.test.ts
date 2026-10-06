import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTask } from "../lib/classifier.ts";
import {
  aiPriority,
  deadProjects,
  decideNow,
  humanLeverage,
  humanLeverageKpi,
  parseIntent,
  portfolioTriage,
  procrastination,
  projectMomentum,
  rankAll,
  selectDrafts,
  simulateDay,
  timeArbitrage,
  timeValue,
  workflowEfficiency,
} from "../lib/optimizer.ts";
import type { Project, Settings, Task, WorkspaceState } from "../lib/types.ts";

const NOW = Date.UTC(2026, 9, 6, 8, 0); // 10:00 Paris
const TZ = -120;
const DAY = 86_400_000;
let seq = 0;

function project(id: string, extra: Partial<Project> = {}): Project {
  return {
    id, name: id.toUpperCase(), color: "#888", description: "", stage: "building", health: "on_track", healthChangedAt: null,
    progress: 0, legacyDone: 0, lastActivityAt: NOW - 3_600_000, kind: "client", strategicValue: 3, revenuePotential: 3,
    goal: "Ship", deadline: null, parkedUntil: null, ...extra,
  };
}

/** Builds a task the same way the app does: from the classifier. */
function task(title: string, extra: Partial<Task> = {}): Task {
  const a = classifyTask(title);
  return {
    id: `t${++seq}`, projectId: null, parentId: null, title, notes: null, mode: a.mode, automation: a.automation, agent: a.agent,
    risk: a.risk, humanValue: a.humanValue, priority: a.priority, humanKind: a.humanKind, humanMinutes: a.humanMinutes,
    aiMinutes: a.aiMinutes, manualMinutes: a.manualMinutes, status: a.mode === "WAITING" ? "waiting" : "todo", reason: a.reason,
    aiPrep: a.aiPrep, tags: a.tags, waitingOn: a.waitingOn, followUpAt: null, scheduledAt: null, location: null, dependsOn: [],
    source: "user", rank: 0, keptHuman: false, autoRun: false, isMission: false, postponedCount: 0, actualHumanMinutes: null,
    createdAt: NOW - DAY, startedAt: null, completedAt: null, delegatedAt: null, unlockedAt: null, handoffAt: null, unlockedBy: null,
    ...extra,
  };
}

const settings: Settings = {
  autopilot: false, simSecondsPerMinute: 3, dayStartMin: 540, dayEndMin: 1140, tzOffsetMin: TZ, userName: "Rémi",
  delegationRules: [], lastAnalysisAt: null, dayUpdate: null, delegationPrompt: null, maxLeverage: false, energy: "medium",
  place: "desk", focus: null, dayPlan: null, efficiencyHistory: [],
};

function state(projects: Project[], tasks: Task[], extra: Partial<WorkspaceState> = {}): WorkspaceState {
  return { now: NOW, projects, tasks, jobs: [], activity: [], opportunities: [], decisions: [], settings: { ...settings }, claudeEnabled: false, ...extra };
}

test("human leverage: client calls and creative decisions high, delegable work low", () => {
  const pp = project("pp", { revenuePotential: 4, strategicValue: 5 });
  const call = humanLeverage(task("Call potential client Patrick Pons"), pp);
  const direction = humanLeverage(task("Choose final visual direction"), pp);
  const research = humanLeverage(task("Research competitors"), pp);
  const css = humanLeverage(task("Fix CSS bug"), pp);
  assert.ok(call.score >= 9.5, `call ${call.score}`);
  assert.ok(direction.score >= 9, `direction ${direction.score}`);
  assert.ok(research.score <= 1.5, `research ${research.score}`);
  assert.ok(css.score <= 1.5, `css ${css.score}`);
  assert.ok(call.reasons.includes("Client relationship"));
});

test("time value: 45 human-only minutes beat 45 minutes of delegable work", () => {
  const p = project("pp", { strategicValue: 5, revenuePotential: 5 });
  const a = task("Meet potential client", { projectId: "pp", humanMinutes: 45 });
  const b = task("Write onboarding documentation", { projectId: "pp", keptHuman: true, humanMinutes: 45 });
  const s = state([p], [a, b]);
  assert.ok(timeValue(a, s, NOW) > timeValue(b, s, NOW) * 5);
});

test("AI queue: work that unblocks Rémi goes before older busywork", () => {
  const p = project("j");
  const refactor = task("Refactor settings page", { projectId: "j", priority: "low", status: "ai_queued", createdAt: NOW - 2 * DAY });
  const bug = task("Fix onboarding bug", { projectId: "j", status: "ai_queued" });
  const review = task("Review onboarding flow", { projectId: "j", dependsOn: [bug.id] });
  const s = state([p], [refactor, bug, review]);
  const pb = aiPriority(bug, s, NOW);
  assert.ok(pb.score > aiPriority(refactor, s, NOW).score);
  assert.match(pb.reason, /Unblocks your “Review onboarding flow”/);
});

test("time arbitrage: fits the window, keeps AI busy in parallel, flags delegable work", () => {
  const p = project("pp", { strategicValue: 5, revenuePotential: 4 });
  const tasks = [
    task("Call Patrick Pons", { projectId: "pp", humanMinutes: 15 }),
    task("Choose final visual direction for Patrick Pons", { projectId: "pp", humanMinutes: 45, mode: "YOU" }),
    task("Meet potential client", { projectId: "pp", humanMinutes: 60 }),
    task("Write weekly update email", { projectId: "pp", keptHuman: true, humanMinutes: 30 }),
    task("Research competitors", { projectId: "pp" }),
    task("Audit mobile responsiveness", { projectId: "pp" }),
  ];
  const plan = timeArbitrage(state([p], tasks), 90, NOW);
  assert.ok(plan.usedMinutes <= 90);
  assert.ok(plan.human.length >= 2);
  assert.ok(plan.human.every((h) => h.leverage >= 6));
  assert.ok(plan.ai.length >= 2, "AI works in parallel");
  assert.equal(plan.delegateInstead[0]?.task.title, "Write weekly update email");
});

test("parallel planner: AI work that depends on a human step starts after it (human → AI)", () => {
  const p = project("pp");
  const record = task("Record voice-over for Patrick Pons", { projectId: "pp", mode: "YOU", humanKind: "creative", humanMinutes: 30 });
  const edit = task("Generate subtitles components", { projectId: "pp", dependsOn: [record.id] });
  const plan = timeArbitrage(state([p], [record, edit]), 120, NOW);
  const h = plan.human.find((x) => x.task.id === record.id)!;
  const a = plan.ai.find((x) => x.task?.id === edit.id)!;
  assert.ok(a, "dependent AI task is planned");
  assert.ok(a.start >= h.end);
});

test("momentum and dead projects: idle, undefined milestone, no activity", () => {
  const live = project("live", { lastActivityAt: NOW - 3_600_000 });
  const dead = project("dead", { lastActivityAt: NOW - 9 * DAY, goal: null, strategicValue: 2, revenuePotential: 2 });
  const tasks = [
    task("Research competitors", { projectId: "live", status: "done", completedAt: NOW - DAY }),
    task("Fix export bug", { projectId: "live" }),
    task("Draft newsletter", { projectId: "dead", postponedCount: 2 }),
    task("Decide roadmap", { projectId: "dead", postponedCount: 1 }),
  ];
  const s = state([live, dead], tasks);
  assert.ok(projectMomentum(live, s, NOW).score > projectMomentum(dead, s, NOW).score);
  const d = deadProjects(s, NOW);
  assert.equal(d.length, 1);
  assert.equal(d[0].project.id, "dead");
  assert.equal(d[0].recommendation, "park");
  assert.ok(d[0].signals.some((x) => x.includes("undefined")));
});

test("overload triage: more than 3 active projects → primary / secondary / park", () => {
  const ps = [
    project("a", { strategicValue: 5, revenuePotential: 5, legacyDone: 20 }),
    project("b", { strategicValue: 4, revenuePotential: 4 }),
    project("c", { strategicValue: 3, revenuePotential: 2 }),
    project("d", { strategicValue: 1, revenuePotential: 1, lastActivityAt: NOW - 10 * DAY }),
  ];
  const tasks = ps.map((p) => task("Fix bug", { projectId: p.id }));
  const t = portfolioTriage(state(ps, tasks), NOW);
  assert.ok(t.overloaded);
  assert.deepEqual(t.primary.map((x) => x.project.id), ["a", "b"]);
  assert.equal(t.park[0].project.id, "d");
  assert.ok(t.park[0].reason.length > 10);
});

test("procrastination: a vague task postponed 4 times is diagnosed", () => {
  const vague = task("Create Jobsy landing page", { postponedCount: 4 });
  const p = procrastination(state([], [vague]), NOW);
  assert.equal(p.length, 1);
  assert.match(p[0].diagnosis, /vague/i);
  assert.ok(p[0].suggestions.includes("break_down"));
});

test("decision engine: does, meanwhile, after", () => {
  const p = project("pp", { strategicValue: 5, revenuePotential: 4 });
  const call = task("Call Patrick Pons", { projectId: "pp", scheduledAt: NOW + 20 * 60_000 });
  const prep = task("Prepare call brief: Call Patrick Pons", { projectId: "pp", parentId: call.id, mode: "AI", agent: "content", automation: 100 });
  const review = task("Decide Patrick Pons pricing", { projectId: "pp" });
  const s = state([p], [call, prep, review]);
  const ranks = rankAll(s, NOW);
  for (const t of s.tasks) t.rank = ranks.get(t.id) ?? 999;
  const d = decideNow(s, NOW);
  assert.equal(d.move?.id, call.id);
  assert.equal(d.meanwhile?.task.id, prep.id);
  assert.equal(d.after?.id, review.id);
  assert.match(d.why, /human-leverage/);
});

test("simulate my day: four strategies with a recommendation", () => {
  const p = project("pp", { strategicValue: 5, revenuePotential: 4, legacyDone: 30 });
  const s = state([p], [task("Call Patrick Pons", { projectId: "pp" }), task("Research competitors", { projectId: "pp" })]);
  const sim = simulateDay(s, 300, NOW);
  assert.deepEqual(sim.strategies.map((x) => x.id), ["finish", "build", "revenue", "balanced"]);
  assert.ok(sim.strategies.some((x) => x.id === sim.recommended));
  assert.ok(sim.reason.length > 10);
});

test("human leverage KPI counts wasted time on delegable work", () => {
  const p = project("pp");
  const done = (title: string, minutes: number, extra: Partial<Task> = {}) =>
    task(title, { projectId: "pp", status: "done", completedAt: NOW - 3_600_000, actualHumanMinutes: minutes, ...extra });
  const s = state([p], [done("Call Patrick Pons", 30), done("Write weekly update email", 30, { keptHuman: true })]);
  const k = humanLeverageKpi(s, NOW - DAY);
  assert.equal(k.pct, 50);
  assert.equal(k.wastedMinutes, 30);
  const e = workflowEfficiency(s, NOW);
  assert.ok(e.score > 0 && e.score <= 100);
});

test("tell your Chief of Staff: focus and park intents (EN/FR)", () => {
  const ps = [{ id: "pp", name: "Patrick Pons" }, { id: "kopi", name: "Kopi" }];
  const a = parseIntent("I'm focusing on Patrick Pons this week", ps, NOW, TZ);
  assert.equal(a.kind, "focus");
  assert.equal(a.projectId, "pp");
  assert.ok(a.days >= 1 && a.days <= 7);
  assert.deepEqual(parseIntent("Je me concentre sur Patrick Pons pendant 2 jours", ps, NOW, TZ), { kind: "focus", projectId: "pp", days: 2 });
  assert.equal(parseIntent("Mets Kopi en pause", ps, NOW, TZ).kind, "park");
  assert.equal(parseIntent("No meetings before 10am", ps, NOW, TZ).kind, "note");
});

test("MODIFY an AI-generated mission: dropped steps are removed from dependencies", () => {
  const drafts = [{ title: "A" }, { title: "B", after: [0] }, { title: "C", after: [0, 1] }];
  assert.deepEqual(selectDrafts(drafts, [0, 2]), [{ title: "A", after: [] }, { title: "C", after: [0] }]);
});

test("pause: fixed duration or until resumed", async () => {
  const { pausedUntilLabel, isParked, PAUSE_INDEFINITE_DAYS } = await import("../lib/optimizer.ts");
  const week = project("p", { parkedUntil: NOW + 7 * DAY });
  const forever = project("q", { parkedUntil: NOW + PAUSE_INDEFINITE_DAYS * DAY });
  assert.ok(isParked(week, NOW) && isParked(forever, NOW));
  assert.match(pausedUntilLabel(week, NOW, TZ)!, /^Paused until \d+ \w+/);
  assert.equal(pausedUntilLabel(forever, NOW, TZ), "Paused until you resume it");
  assert.equal(pausedUntilLabel(project("r"), NOW, TZ), null);
});
