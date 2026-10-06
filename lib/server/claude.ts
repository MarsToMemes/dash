import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AGENTS } from "../agents.ts";
import type { AgentRole, ExecutionMode, Project, Task, TaskAnalysis } from "../types.ts";

// Optional real execution layer. With ANTHROPIC_API_KEY (or another credential
// the SDK resolves) set, task classification is refined by Claude and textual
// agents (research, content, design briefs, analysis, operations) produce real
// deliverables. Without it, everything runs on the heuristic classifier and
// the simulated executor — and the UI says so.

const MODEL = process.env.DASH_MODEL ?? "claude-opus-5-5";

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "agent", "risk", "human_value", "human_minutes", "ai_minutes", "manual_minutes", "reason", "ai_prep"],
  properties: {
    mode: { type: "string", enum: ["YOU", "AI", "AI_YOU", "WAITING"] },
    agent: { type: ["string", "null"], enum: ["research", "coding", "design", "content", "operations", "analyst", null] },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    human_value: { type: "integer", enum: [1, 2, 3, 4, 5] },
    human_minutes: { type: "integer" },
    ai_minutes: { type: "integer" },
    manual_minutes: { type: "integer" },
    reason: { type: "string" },
    ai_prep: { type: "array", items: { type: "string" } },
  },
} as const;

const CLASSIFY_SYSTEM = `You are the Chief of Staff of a freelance designer-developer named Rémi. For each task you decide WHO should execute it.

Modes:
- YOU: requires Rémi personally (presence, phone, relationships, negotiation, signatures, final creative or strategic decisions).
- AI: an AI agent can execute it end to end (research, drafts, code, tests, analysis, organization).
- AI_YOU: AI prepares (research, options, drafts) and Rémi makes the final decision.
- WAITING: blocked by someone external.

Agents: research, coding, design, content, operations, analyst. For YOU tasks, "agent" is the agent that can prepare material (or null).
Risk: low = AI may act alone; medium = AI prepares, human approves (sending, publishing, production changes, deletions); high = human approval always (money, contracts, sensitive communications, important data).
human_value: how valuable it is for Rémi to spend his own time on it (1 very low … 5 very high).
Minutes: human_minutes = Rémi's own time; ai_minutes = agent execution time; manual_minutes = time if Rémi did everything by hand.
reason: one short sentence, plain and specific, no hype. ai_prep: up to 5 short items the AI can prepare (empty if none).`;

/** Ask Claude for a second opinion; returns null on any failure so callers fall back to the heuristic. */
export async function classifyWithClaude(
  title: string,
  heuristic: TaskAnalysis,
  project: Project | null,
): Promise<TaskAnalysis | null> {
  if (!claudeEnabled()) return null;
  try {
    const response = await getClient().messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        output_config: { effort: "low", format: { type: "json_schema", schema: CLASSIFY_SCHEMA } },
        system: CLASSIFY_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Task: ${title}${project ? `\nProject: ${project.name} — ${project.description}` : ""}`,
          },
        ],
      },
      { timeout: 20_000 },
    );
    if (response.stop_reason === "refusal") return null;
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    const parsed = JSON.parse(text.text) as {
      mode: ExecutionMode;
      agent: AgentRole | null;
      risk: TaskAnalysis["risk"];
      human_value: TaskAnalysis["humanValue"];
      human_minutes: number;
      ai_minutes: number;
      manual_minutes: number;
      reason: string;
      ai_prep: string[];
    };
    const automation: TaskAnalysis["automation"] =
      parsed.mode === "AI" ? (parsed.risk === "low" ? 100 : 75)
      : parsed.mode === "AI_YOU" ? 50
      : parsed.mode === "YOU" && parsed.ai_prep.length ? 25
      : 0;
    return {
      ...heuristic,
      mode: parsed.mode,
      agent: parsed.agent,
      risk: parsed.risk,
      humanValue: parsed.human_value,
      humanMinutes: Math.max(0, parsed.human_minutes),
      aiMinutes: Math.max(0, parsed.ai_minutes),
      manualMinutes: Math.max(parsed.manual_minutes, parsed.human_minutes),
      reason: parsed.reason,
      aiPrep: parsed.ai_prep.slice(0, 5),
      automation,
      // Keep the heuristic's mission split and waiting target: they are structural.
      humanKind: parsed.mode === "YOU" || parsed.mode === "AI_YOU" ? (heuristic.humanKind ?? "generic") : null,
      source: "claude",
    };
  } catch (err) {
    console.warn("[dash] Claude classification failed, using heuristic:", err instanceof Error ? err.message : err);
    return null;
  }
}

function agentSystem(role: AgentRole): string {
  const a = AGENTS[role];
  return `You are the ${a.name} in Rémi's AI workforce. You handle: ${a.handles}.
Rémi is a freelance designer-developer. Produce the deliverable itself, not a plan to produce it.
Write in concise Markdown: a one-line summary, then the deliverable. Flag anything you could not verify, and list open questions that need Rémi at the end under "Needs you". No filler.`;
}

/** Execute a textual agent job with Claude. Throws on failure. */
export async function executeWithClaude(task: Task, role: AgentRole, context: string): Promise<string> {
  const anthropic = getClient();
  const tools: Anthropic.Beta.BetaToolUnion[] =
    role === "research" || role === "analyst" ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }] : [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Task: ${task.title}\n${task.notes ? `Notes: ${task.notes}\n` : ""}${context}`,
    },
  ];
  // Server tools can pause a long turn; resume a few times at most.
  for (let attempt = 0; attempt < 4; attempt++) {
    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: agentSystem(role),
      tools,
      messages,
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error("The model declined this task.");
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("Empty response.");
    return text;
  }
  throw new Error("The agent did not finish within its turn budget.");
}
