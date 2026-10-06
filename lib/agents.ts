import type { AgentRole } from "./types.ts";

export interface AgentProfile {
  role: AgentRole;
  name: string;
  short: string;
  handles: string;
  /** Default AI execution minutes / manual (human) minutes for a typical job. */
  aiMinutes: number;
  manualMinutes: number;
  /** Narrated steps for the activity feed; {n} gets a plausible count. */
  steps: string[];
  /** Agents whose output is text and can be executed by Claude directly. */
  textual: boolean;
}

export const AGENTS: Record<AgentRole, AgentProfile> = {
  research: {
    role: "research",
    name: "Research Agent",
    short: "Research",
    handles: "Competitors, markets, references, companies, prospects, trends",
    aiMinutes: 20,
    manualMinutes: 90,
    steps: ["Collecting sources", "Reading {n} sources", "Comparing findings", "Writing the brief"],
    textual: true,
  },
  coding: {
    role: "coding",
    name: "Coding Agent",
    short: "Coding",
    handles: "Code, bugs, components, refactoring, tests",
    aiMinutes: 25,
    manualMinutes: 120,
    steps: ["Inspecting the repository", "Writing changes", "Running {n} tests", "Preparing the diff"],
    textual: false,
  },
  design: {
    role: "design",
    name: "Design Agent",
    short: "Design",
    handles: "UI exploration, layouts, design systems, variations",
    aiMinutes: 20,
    manualMinutes: 120,
    steps: ["Gathering references", "Exploring {n} directions", "Composing layouts", "Exporting concepts"],
    textual: true,
  },
  content: {
    role: "content",
    name: "Content Agent",
    short: "Content",
    handles: "Copywriting, scripts, emails, documentation, SEO",
    aiMinutes: 12,
    manualMinutes: 45,
    steps: ["Reading context", "Outlining", "Drafting", "Polishing tone"],
    textual: true,
  },
  operations: {
    role: "operations",
    name: "Operations Agent",
    short: "Ops",
    handles: "Task organization, reports, follow-ups, admin",
    aiMinutes: 8,
    manualMinutes: 30,
    steps: ["Scanning workspace", "Sorting {n} items", "Writing summary"],
    textual: true,
  },
  analyst: {
    role: "analyst",
    name: "Analyst Agent",
    short: "Analyst",
    handles: "Data, metrics, comparisons, business analysis",
    aiMinutes: 15,
    manualMinutes: 60,
    steps: ["Loading data", "Measuring {n} signals", "Spotting patterns", "Writing conclusions"],
    textual: true,
  },
};

export const AGENT_ORDER: AgentRole[] = ["research", "coding", "design", "content", "operations", "analyst"];
