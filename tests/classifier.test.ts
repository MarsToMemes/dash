import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTask } from "../lib/classifier.ts";

const cases: [string, string, string | null][] = [
  // title, expected mode, expected agent (null = don't care)
  ["Call Patrick Pons and convince them to work with me", "YOU", null],
  ["Appeler Patrick Pons", "YOU", null],
  ["Meet potential client", "YOU", null],
  ["Visit motorcycle showroom", "YOU", null],
  ["Sign the Kopi contract", "YOU", null],
  ["Make a competitive analysis for Jobsy", "AI", "research"],
  ["Research 10 Patrick Pons competitors", "AI", "research"],
  ["Fix the checkout bug", "AI", "coding"],
  ["Fix Jobsy signup form validation", "AI", "coding"],
  ["Valider la maquette finale", "AI_YOU", "design"],
  ["Generate product page components", "AI", "coding"],
  ["Improve Patrick Pons website SEO", "AI", "content"],
  ["Audit your portfolio website", "AI", "analyst"],
  ["Clean up Jobsy task backlog", "AI", "operations"],
  ["Prepare 15 outreach prospects", "AI", "research"],
  ["Create 5 homepage concepts", "AI_YOU", "design"],
  ["Approve Patrick Pons visual direction", "AI_YOU", "design"],
  ["Decide AI Video Editor roadmap", "YOU", null],
  ["Waiting for Patrick Pons to send product photography", "WAITING", null],
  ["En attente de Kopi pour les photos", "WAITING", null],
];

for (const [title, mode, agent] of cases) {
  test(`${title} → ${mode}${agent ? ` / ${agent}` : ""}`, () => {
    const a = classifyTask(title);
    assert.equal(a.mode, mode, a.reason);
    if (agent) assert.equal(a.agent, agent);
  });
}

test("human-only calls come with AI preparation", () => {
  const a = classifyTask("Call Patrick Pons and convince them to work with me");
  assert.equal(a.humanKind, "call");
  assert.equal(a.humanValue, 5);
  assert.ok(a.aiPrep.includes("Call script"));
  assert.match(a.reason, /Phone conversation/);
  assert.match(a.reason, /negotiation/i);
  assert.equal(a.automation, 25);
});

test("sending and publishing require approval; money is high risk", () => {
  assert.equal(classifyTask("Send the newsletter to all customers").risk, "medium");
  assert.equal(classifyTask("Pay the hosting invoice").risk, "high");
  assert.equal(classifyTask("Research competitors").risk, "low");
});

test("fully automatable research has very low human value", () => {
  const a = classifyTask("Research competitors");
  assert.equal(a.automation, 100);
  assert.equal(a.humanValue, 1);
  assert.equal(a.humanMinutes, 0);
  assert.ok(a.manualMinutes > a.aiMinutes);
});

test("getting a new client becomes a human + AI mission chain", () => {
  const a = classifyTask("Get a new client");
  assert.equal(a.mission.length, 10);
  const firstHuman = a.mission.findIndex((d) => d.mode === "YOU");
  assert.equal(firstHuman, 6);
  assert.ok(a.mission.slice(0, 6).every((d) => d.mode === "AI"));
});

test("delegation rules force AI ownership", () => {
  const before = classifyTask("Update the weekly client report");
  const after = classifyTask("Update the weekly client report", { delegationRules: ["update report"] });
  assert.equal(after.mode, "AI");
  assert.notEqual(before.reason, after.reason);
});

test("explicit durations are respected", () => {
  assert.equal(classifyTask("Client meeting 1h30").humanMinutes, 90);
  assert.equal(classifyTask("Call the bank 20 min").humanMinutes, 20);
});

test("delegation phrases generalise across projects", async () => {
  const { delegationPhrase } = await import("../lib/classifier.ts");
  const phrase = delegationPhrase("Clean up Jobsy task backlog");
  assert.equal(phrase, "clean backlog");
  assert.equal(classifyTask("Clean the Kopi backlog", { delegationRules: [phrase] }).reason, "You asked me to always delegate this kind of work.");
});
