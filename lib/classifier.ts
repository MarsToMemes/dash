// Heuristic task classifier — the Chief of Staff's first opinion on every task.
//
// It is deliberately deterministic and runs everywhere (browser, server, tests),
// so task analysis appears instantly while typing. When an Anthropic key is
// configured the server refines it with Claude (lib/server/claude.ts), but the
// product must stay useful without it.
//
// Matching is done on lower-cased, accent-stripped text and understands
// English and French phrasing.

import { AGENTS } from "./agents.ts";
import type {
  AgentRole,
  AutomationPotential,
  ExecutionMode,
  HumanKind,
  HumanValue,
  Priority,
  RiskLevel,
  TaskAnalysis,
  TaskDraft,
} from "./types.ts";

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface HumanSignal {
  kind: HumanKind;
  re: RegExp;
  factor: string;
  minutes: number;
  value: HumanValue;
}

// Order matters: the first matching signal sets the kind, every match adds a factor.
const HUMAN_SIGNALS: HumanSignal[] = [
  { kind: "signature", re: /\b(sign|signer|signe[rz]?|signature)\b/, factor: "Legal signature", minutes: 10, value: 5 },
  { kind: "call", re: /\b(call|phone|ring|appele[rz]?|appel|telephone[rz]?|facetime)\b/, factor: "Phone conversation", minutes: 10, value: 5 },
  { kind: "meeting", re: /\b(meet|meeting|rencontre[rz]?|reunion|rdv|rendez[- ]vous|lunch|dejeuner|attend|assister|interview|entretien)\b/, factor: "Physical or live presence", minutes: 45, value: 5 },
  { kind: "onsite", re: /\b(visit|visite[rz]?|on site|sur place|showroom|go to|aller (a|au|chez)|photo ?shoot|shooting|take (photos|pictures)|prendre des photos|photographier)\b/, factor: "On-site presence", minutes: 90, value: 5 },
  { kind: "relationship", re: /\b(negotiat\w*|negocie[rz]?|negociation|convince|convaincre|networking|network|relationship|relation|thank|remercier)\b/, factor: "Relationship + negotiation", minutes: 30, value: 5 },
  { kind: "meeting", re: /\b(present|presenting|presenter|presentation|pitch to|demo to|keynote|talk at)\b/, factor: "Presenting in person", minutes: 45, value: 5 },
  { kind: "decision", re: /\b(approve|approuver|valide[rz]?|validation|choose|choisir|decide|decider|decision|select|selectionner|arbitrer|sign[- ]off|final (direction|design|call)|go\/no[- ]go)\b/, factor: "Your judgment", minutes: 15, value: 4 },
  { kind: "review", re: /\b(review|relire|revoir|feedback on)\b/, factor: "Your review", minutes: 15, value: 3 },
];

interface AgentSignal {
  agent: AgentRole;
  re: RegExp;
  tag: string;
}

const AGENT_SIGNALS: AgentSignal[] = [
  { agent: "coding", re: /\b(code|coder|bug|bugs|fix|corrige[rz]?|refactor\w*|component\w*|composant\w*|tests?|unit test|deploy\w*|deploie[rz]?|api|implement\w*|integre[rz]?|develop\w*|developpe[rz]?|script|responsive\w*|optimi[sz]\w*|repo|repository|pull request|pr|typescript|react|css|frontend|backend|lint|broken links?|liens? casses?|build|migration|optimi[sz]e images|compress)\b/, tag: "Code" },
  { agent: "design", re: /\b(design|ui|ux|layout|maquette\w*|mockup\w*|wireframe\w*|moodboard|concepts?|design system|variations?|prototype\w*|homepage|landing page visuals?|visuals?|logo|figma|screens?|screenshots?|ecrans?)\b/, tag: "Design" },
  { agent: "research", re: /\b(research|recherche[rz]?|find|trouve[rz]?|competitors?|competiti\w*|concurren\w*|benchmark\w*|market|marche|prospects?|leads?|veille|references?|trends?|tendances?|collect\w*|look up|sourcing|decision maker|companies|entreprises?)\b/, tag: "Research" },
  { agent: "analyst", re: /\b(analy[sz]\w*|audit\w*|metrics?|metriques?|kpis?|data|donnees|stats?|statistiques?|performance|lighthouse|report|rapport|compare[rz]?|comparison|measure|mesure[rz]?|roi|pricing analysis|seo audit|diagnos\w*)\b/, tag: "Analysis" },
  { agent: "content", re: /\b(write|ecrire|redige[rz]?|draft\w*|brouillon|copy|copywriting|email|e-mail|mail|newsletter|scripts?|documentation|docs?|seo|meta ?(data|description|tags)|blog|article|caption\w*|post|linkedin|case study|etude de cas|pitch|proposal|proposition|devis|cv|bio|description)\b/, tag: "Content" },
  { agent: "operations", re: /\b(organi[sz]e[rz]?|organiser|clean ?up|nettoye[rz]?|backlog|triage|trier|follow[- ]?up|relance[rz]?|relance|schedule|planifie[rz]?|admin\w*|files?|fichiers?|folders?|dossiers?|invoices?|factures?|archive[rz]?|sort|ranger|inbox|checklist|todo list)\b/, tag: "Operations" },
];

const WAITING_RE = /\b(waiting (for|on)|wait for|awaiting|attendre|en attente( de)?|blocked by|bloque par|pending from|depends on .* to send|doit (m |nous )?envoyer|needs? to send me|has to send)\b/;
const WAITING_WHO_RE = /\b(?:waiting (?:for|on)|wait for|awaiting|attendre|en attente de|blocked by|bloque par|pending from)\s+([a-z0-9][\w-]*(?: [a-z0-9][\w-]*)?)/;

const OPTIONS_RE = /\b(\d+\s+)?(concepts?|options?|directions?|variations?|proposals?|propositions?|pistes?|alternatives?|shortlist)\b/;
const SEND_PUBLISH_RE = /\b(send|envoye[rz]?|envoi|publish|publie[rz]?|post (it|on)|go live|mettre en ligne|deploy to prod\w*|production|prod|merge|delete|supprime[rz]?|modify production)\b/;
const HIGH_RISK_RE = /\b(pay|payer|paiement|payment|virement|wire|transfer (money|funds)|contract|contrat|sign|signer|delete (all|the database|important)|drop (table|database)|bank|banque|legal|juridique|sensitive|confidential|confidentiel)\b/;
const URGENT_RE = /\b(urgent|asap|today|aujourd hui|now|maintenant|critical|critique|immediately|tout de suite|deadline|ce soir|tonight)\b/;
const CLIENT_RE = /\b(client|customer|prospect|lead|investor|investisseur|partner|partenaire|deal)\b/;
const LOW_RE = /\b(someday|un jour|maybe|peut[- ]etre|nice to have|idea|idee)\b/;

const MISSION_RE = /\b(get|win|land|sign|find|acquire|trouver|decrocher|signer|gagner) (a |an |un |une )?(new )?(nouveau |nouvelle )?(client|customer|deal|contrat)\b/;

const PREP_BY_KIND: Record<HumanKind, string[]> = {
  call: ["Talking points", "Company research", "Likely objections", "Pitch", "Call script"],
  meeting: ["Attendee research", "Agenda", "Meeting brief", "Questions to ask"],
  onsite: ["Itinerary", "Visit checklist", "Context brief"],
  relationship: ["Background research", "Talking points", "Objection handling", "Follow-up draft"],
  signature: ["Contract summary", "Risk checklist"],
  decision: ["Options side by side", "Trade-offs", "Recommendation"],
  creative: ["References", "Moodboard", "Variations"],
  review: ["Summary of changes", "What to look at first"],
  generic: [],
};

const REASON_BY_AGENT: Record<AgentRole, string> = {
  research: "Research and synthesis — no presence or judgment needed.",
  coding: "Code work an agent can do and verify with tests.",
  design: "Exploration an agent can generate quickly.",
  content: "Drafting from context — an agent writes, you skim.",
  operations: "Administrative work — pure execution.",
  analyst: "Measuring and comparing — an agent is faster and more thorough.",
};

function parseExplicitMinutes(t: string): number | null {
  const hm = t.match(/\b(\d{1,2})\s*h\s*(\d{1,2})\b/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const h = t.match(/\b(\d{1,2}(?:[.,]5)?)\s*(?:h|hours?|heures?)\b/);
  if (h) return Math.round(Number(h[1].replace(",", ".")) * 60);
  const m = t.match(/\b(\d{1,3})\s*(?:min|mins|minutes?)\b/);
  if (m) return Number(m[1]);
  return null;
}

/** "Research 10 competitors" → scale AI effort with the count, gently. */
function quantityFactor(t: string): number {
  const n = t.match(/\b(\d{1,3})\s+(?!min|h\b|hours?|heures?)[a-z]/);
  if (!n) return 1;
  const q = Number(n[1]);
  if (q <= 3) return 1;
  return Math.min(2.5, 1 + Math.log10(q) * 0.8);
}

function roundTo(n: number, step: number): number {
  return Math.max(step, Math.round(n / step) * step);
}

function automationFor(mode: ExecutionMode, risk: RiskLevel, hasPrep: boolean): AutomationPotential {
  switch (mode) {
    case "AI":
      return risk === "low" ? 100 : 75;
    case "AI_YOU":
      return 50;
    case "YOU":
      return hasPrep ? 25 : 0;
    case "WAITING":
      return 0;
  }
}

/** Phrase used to remember a delegation preference ("always delegate X"). */
export function delegationPhrase(title: string): string {
  const stop = new Set(["the", "a", "an", "for", "to", "of", "on", "and", "le", "la", "les", "de", "des", "du", "pour", "un", "une", "et", "my", "mon", "ma", "mes"]);
  return normalize(title)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w))
    .filter((w, i, all) => i === 0 || i === all.length - 1) // verb + object: "clean … backlog"
    .join(" ");
}

/** A rule matches when all its words appear in the task, in any order. */
function matchesRule(normalizedTitle: string, rule: string): boolean {
  const words = new Set(normalizedTitle.replace(/[^a-z0-9 ]/g, " ").split(" "));
  const parts = rule.split(" ").filter(Boolean);
  return parts.length > 0 && parts.every((w) => words.has(w));
}

export interface ClassifyOptions {
  delegationRules?: string[];
}

export function classifyTask(title: string, opts: ClassifyOptions = {}): TaskAnalysis {
  const t = normalize(title);
  const explicitMinutes = parseExplicitMinutes(t);
  const qty = quantityFactor(t);

  const humanHits = HUMAN_SIGNALS.filter((s) => s.re.test(t));
  const agentHits = AGENT_SIGNALS.filter((s) => s.re.test(t));
  const waiting = WAITING_RE.test(t);
  const asksForOptions = OPTIONS_RE.test(t);
  const sendsOrPublishes = SEND_PUBLISH_RE.test(t);
  const highRisk = HIGH_RISK_RE.test(t);
  const urgent = URGENT_RE.test(t);
  const involvesClient = CLIENT_RE.test(t);
  const ruleMatch = (opts.delegationRules ?? []).some((r) => matchesRule(t, r));

  let priority: Priority = urgent ? "high" : LOW_RE.test(t) ? "low" : "medium";
  if (urgent && involvesClient) priority = "critical";
  else if (involvesClient && priority === "medium") priority = "high";

  const risk: RiskLevel = highRisk ? "high" : sendsOrPublishes ? "medium" : "low";
  const agent: AgentRole | null = agentHits[0]?.agent ?? null;
  const tags = Array.from(new Set(agentHits.map((a) => a.tag))).slice(0, 3);

  // ---- WAITING ----------------------------------------------------------
  if (waiting) {
    const who = t.match(WAITING_WHO_RE)?.[1] ?? null;
    const waitingOn = who ? titleCaseFrom(title, who) : null;
    return {
      mode: "WAITING",
      automation: 0,
      agent: "operations",
      risk: "low",
      humanValue: 2,
      priority,
      humanKind: null,
      humanMinutes: 0,
      aiMinutes: AGENTS.operations.aiMinutes,
      manualMinutes: 10,
      reason: `Blocked by ${waitingOn ?? "someone else"}. I'll watch it and draft follow-ups.`,
      aiPrep: ["Monitor", "Follow-up draft"],
      tags: ["Waiting"],
      waitingOn,
      mission: [],
      source: "heuristic",
    };
  }

  // ---- Multi-step mission (e.g. "Get a new client") ----------------------
  if (MISSION_RE.test(t)) {
    return {
      mode: "AI_YOU",
      automation: 50,
      agent: "research",
      risk: "medium",
      humanValue: 5,
      priority: priority === "medium" ? "high" : priority,
      humanKind: "relationship",
      humanMinutes: 70,
      aiMinutes: 55,
      manualMinutes: 300,
      reason: "A mission, not a task: AI does the groundwork, you own the relationship.",
      aiPrep: ["Company research", "Decision maker", "Website analysis", "Opportunities", "Personalized pitch", "Email draft"],
      tags: ["Mission", "Sales"],
      waitingOn: null,
      mission: clientMission(),
      source: "heuristic",
    };
  }

  // ---- Human only ------------------------------------------------------
  const strongHuman = humanHits.filter((h) => h.kind !== "decision" && h.kind !== "review");
  if (strongHuman.length > 0 && !ruleMatch) {
    const primary = strongHuman[0];
    const factors = Array.from(new Set(humanHits.map((h) => h.factor)));
    const prep = PREP_BY_KIND[primary.kind];
    const minutes = explicitMinutes ?? Math.max(...strongHuman.map((h) => h.minutes));
    return {
      mode: "YOU",
      automation: automationFor("YOU", risk, prep.length > 0),
      agent: prep.length > 0 ? "research" : null,
      risk,
      humanValue: 5,
      priority: priority === "medium" ? "high" : priority,
      humanKind: primary.kind,
      humanMinutes: minutes,
      aiMinutes: prep.length > 0 ? 10 : 0,
      manualMinutes: minutes + (prep.length > 0 ? 30 : 0),
      reason: `Human-only. ${factors.join(" + ")}.`,
      aiPrep: prep,
      tags: Array.from(new Set([kindTag(primary.kind), ...tags])).slice(0, 3),
      waitingOn: null,
      mission: [],
      source: "heuristic",
    };
  }

  // ---- Decision / review on top of AI-preparable work → AI prepares, you decide
  const decision = humanHits.find((h) => h.kind === "decision" || h.kind === "review");
  if (decision && !ruleMatch) {
    const prepAgent: AgentRole = agent ?? (asksForOptions ? "design" : "analyst");
    const profile = AGENTS[prepAgent];
    const humanMinutes = explicitMinutes ?? decision.minutes;
    // "Approve the homepage" with nothing to prepare is still a pure human decision.
    const pureDecision = agentHits.length === 0 && !asksForOptions;
    return {
      mode: pureDecision ? "YOU" : "AI_YOU",
      automation: pureDecision ? 25 : 50,
      agent: prepAgent,
      risk,
      humanValue: pureDecision ? 4 : 4,
      priority,
      humanKind: decision.kind,
      humanMinutes,
      aiMinutes: pureDecision ? 5 : roundTo(profile.aiMinutes * qty, 5),
      manualMinutes: pureDecision ? humanMinutes + 20 : roundTo(profile.manualMinutes * qty, 5) + humanMinutes,
      reason: pureDecision
        ? `Your call to make. AI can lay out the options first.`
        : `AI prepares → you decide. ${decision.factor} is the only human part.`,
      aiPrep: PREP_BY_KIND[decision.kind],
      tags: Array.from(new Set(["Decision", ...tags])).slice(0, 3),
      waitingOn: null,
      mission: [],
      source: "heuristic",
    };
  }

  // ---- AI with options to choose from → AI prepares, you decide ------------
  if (agent && asksForOptions && !ruleMatch) {
    const profile = AGENTS[agent];
    return {
      mode: "AI_YOU",
      automation: 50,
      agent,
      risk,
      humanValue: 4,
      priority,
      humanKind: "decision",
      humanMinutes: explicitMinutes ?? 20,
      aiMinutes: roundTo(profile.aiMinutes * qty, 5),
      manualMinutes: roundTo(profile.manualMinutes * qty, 5),
      reason: "AI prepares the options → you pick the direction.",
      aiPrep: ["References", "Options", "Prototypes"],
      tags,
      waitingOn: null,
      mission: [],
      source: "heuristic",
    };
  }

  // ---- AI executable ---------------------------------------------------
  if (agent || ruleMatch) {
    const role: AgentRole = agent ?? "operations";
    const profile = AGENTS[role];
    const aiMinutes = roundTo(profile.aiMinutes * qty, 1);
    return {
      mode: "AI",
      automation: automationFor("AI", risk, false),
      agent: role,
      risk,
      humanValue: role === "operations" || role === "analyst" || role === "research" ? 1 : 2,
      priority,
      humanKind: null,
      humanMinutes: risk === "low" ? 0 : 5,
      aiMinutes,
      manualMinutes: explicitMinutes ?? roundTo(profile.manualMinutes * qty, 5),
      reason: ruleMatch
        ? "You asked me to always delegate this kind of work."
        : risk === "low"
          ? REASON_BY_AGENT[role]
          : `${REASON_BY_AGENT[role]} It ${risk === "high" ? "touches something sensitive" : "goes out into the world"}, so you approve before it ships.`,
      aiPrep: [],
      tags: tags.length ? tags : [profile.short],
      waitingOn: null,
      mission: [],
      source: "heuristic",
    };
  }

  // ---- Unknown: keep it human but say so honestly -----------------------
  return {
    mode: "YOU",
    automation: 0,
    agent: null,
    risk,
    humanValue: 3,
    priority,
    humanKind: "generic",
    humanMinutes: explicitMinutes ?? 30,
    aiMinutes: 0,
    manualMinutes: explicitMinutes ?? 30,
    reason: "I can't tell what an agent would do here — kept with you. Add detail to let me delegate.",
    aiPrep: [],
    tags: [],
    waitingOn: null,
    mission: [],
    source: "heuristic",
  };
}

function kindTag(kind: HumanKind): string {
  return {
    call: "Call",
    meeting: "Meeting",
    onsite: "On site",
    decision: "Decision",
    creative: "Creative",
    relationship: "Relationship",
    signature: "Signature",
    review: "Review",
    generic: "Human",
  }[kind];
}

/** Recover original casing for an extracted name ("patrick pons" → "Patrick Pons"). */
function titleCaseFrom(original: string, needle: string): string {
  const idx = normalize(original).indexOf(needle);
  if (idx >= 0) return original.slice(idx, idx + needle.length);
  return needle.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** GET A NEW CLIENT → AI groundwork, then the human relationship steps. */
export function clientMission(): TaskDraft[] {
  return [
    { title: "Research the company", mode: "AI", agent: "research", tags: ["Research"] },
    { title: "Find the decision maker", mode: "AI", agent: "research", tags: ["Research"], after: [0] },
    { title: "Analyze their website", mode: "AI", agent: "analyst", tags: ["Analysis"], after: [0] },
    { title: "Identify opportunities", mode: "AI", agent: "analyst", tags: ["Analysis"], after: [2] },
    { title: "Prepare a personalized pitch", mode: "AI", agent: "content", tags: ["Content"], after: [1, 3] },
    { title: "Draft the outreach email", mode: "AI", agent: "content", tags: ["Content"], after: [4] },
    { title: "Review the pitch and email", mode: "YOU", humanKind: "review", after: [5] },
    { title: "Send the email", mode: "YOU", humanKind: "relationship", after: [6] },
    { title: "Call the decision maker", mode: "YOU", humanKind: "call", after: [7] },
    { title: "Meet the client", mode: "YOU", humanKind: "meeting", after: [8] },
  ];
}

export const MODE_LABEL: Record<ExecutionMode, string> = {
  YOU: "YOU",
  AI: "AI",
  AI_YOU: "AI + YOU",
  WAITING: "WAITING",
};

export const AUTOMATION_LABEL: Record<AutomationPotential, string> = {
  0: "Human only",
  25: "Mostly human",
  50: "Shared",
  75: "Mostly AI",
  100: "Fully automatable",
};

export const HUMAN_VALUE_LABEL: Record<HumanValue, string> = {
  1: "Very low",
  2: "Low",
  3: "Medium",
  4: "High",
  5: "Very high",
};
