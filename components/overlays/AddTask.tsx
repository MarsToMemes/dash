"use client";

import clsx from "clsx";
import { CalendarClock, CornerDownLeft, Play, Plus, Sparkles, User } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS } from "@/lib/agents";
import { AUTOMATION_LABEL, classifyTask } from "@/lib/classifier";
import { fmtDuration } from "@/lib/planner";
import { useWorkspace } from "../store";
import { AGENT_ICON, Button, Kbd, ModeBadge, Tag } from "../ui";

const EXAMPLES = [
  "Make a competitive analysis for Jobsy",
  "Call Patrick Pons and convince them to work with me",
  "Create 5 homepage concepts for Kopi",
  "Get a new client",
  "Waiting for Patrick Pons to send product photography",
];

/** SMART TASK CREATION — every task is analysed as you type. */
export function AddTask() {
  const { state, addOpen, setAddOpen, addSeed, act } = useWorkspace();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    if (addOpen) {
      setTitle(addSeed);
      setDebounced(addSeed);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [addOpen, addSeed]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(title), 140);
    return () => clearTimeout(t);
  }, [title]);

  const analysis = useMemo(
    () => (debounced.trim().length > 2 ? classifyTask(debounced, { delegationRules: state?.settings.delegationRules }) : null),
    [debounced, state?.settings.delegationRules],
  );

  const close = () => {
    setAddOpen(false);
    setTitle("");
    setProjectId(null);
  };

  const submit = async (intent: "run" | "schedule" | "me" | "auto") => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await act({ type: "create_task", title: title.trim(), projectId, intent });
    setBusy(false);
    close();
  };

  const aiCapable = analysis && (analysis.mode === "AI" || analysis.mode === "AI_YOU");
  const AgentIcon = analysis?.agent ? AGENT_ICON[analysis.agent] : Sparkles;

  return (
    <AnimatePresence>
      {addOpen && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={close} />
          <motion.div
            role="dialog"
            aria-label="New task"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="relative w-full max-w-[640px] overflow-hidden rounded-[28px] bg-app shadow-[var(--shadow-lift)] ring-1 ring-line-2 backdrop-blur-2xl"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit((e.metaKey || e.ctrlKey) && aiCapable ? "run" : "auto");
              }
            }}
          >
            <div className="flex items-center gap-3 px-6 pt-6">
              <Plus size={20} className="text-ai" />
              <input
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to happen?"
                maxLength={300}
                className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold tracking-tight outline-none placeholder:text-ink-3"
              />
            </div>
            <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-6 pt-4">
              {[{ id: null, name: "No project", color: "var(--text-3)" }, ...(state?.projects ?? [])].map((p) => (
                <button
                  key={p.id ?? "none"}
                  onClick={() => setProjectId(p.id)}
                  className={clsx(
                    "inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-colors",
                    projectId === p.id ? "bg-ink text-app" : "bg-card-2 text-ink-2 hover:text-ink",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>

            <div className="mt-5 border-t border-line px-6 py-5">
              <AnimatePresence mode="wait" initial={false}>
                {!analysis ? (
                  <motion.div key="examples" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">Try</div>
                    <div className="mt-2 flex flex-col">
                      {EXAMPLES.map((ex) => (
                        <button key={ex} onClick={() => setTitle(ex)} className="rounded-xl px-2 py-1.5 text-left text-[13.5px] text-ink-2 hover:bg-card-2 hover:text-ink">
                          {ex}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="analysis" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">Task analysis</div>
                      <span className="text-[11px] text-ink-3">{state?.claudeEnabled ? "Claude refines on save" : "Local heuristics"}</span>
                    </div>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={headline(analysis)}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2 }}
                        className="mt-3 text-[18px] font-semibold tracking-tight"
                      >
                        {headline(analysis)}
                      </motion.div>
                    </AnimatePresence>
                    <p className="mt-1 text-[13px] text-ink-2">{analysis.reason}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Cell label="Owner">
                        {analysis.mode === "YOU" ? (
                          <span className="text-human">You</span>
                        ) : analysis.agent ? (
                          <span className="inline-flex items-center gap-1.5 text-ai">
                            <AgentIcon size={14} /> {AGENTS[analysis.agent].short}
                          </span>
                        ) : (
                          "—"
                        )}
                      </Cell>
                      <Cell label="Mode">
                        <ModeBadge mode={analysis.mode} />
                      </Cell>
                      <Cell label="Estimated">{analysis.mode === "AI" ? `${analysis.aiMinutes} min AI` : fmtDuration(analysis.humanMinutes)}</Cell>
                      <Cell label="Human involvement">
                        {analysis.mode === "AI" ? (analysis.risk === "low" ? "None" : "Approval") : analysis.mode === "WAITING" ? "Follow-ups" : fmtDuration(analysis.humanMinutes)}
                      </Cell>
                    </div>
                    <div className="mt-3 text-[12px] text-ink-3">
                      Automation {analysis.automation}% — {AUTOMATION_LABEL[analysis.automation]}
                    </div>
                    {analysis.aiPrep.length > 0 && (
                      <div className="mt-4">
                        <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">
                          {analysis.mode === "YOU" ? "AI prep → then you act" : "AI prepares"}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {analysis.aiPrep.map((p) => (
                            <Tag key={p}>{p}</Tag>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.mission.length > 0 && (
                      <ol className="mt-4 grid gap-1 sm:grid-cols-2">
                        {analysis.mission.map((d, i) => (
                          <li key={i} className="flex items-center gap-2 text-[12.5px]">
                            <span className={clsx("h-1.5 w-1.5 rounded-full", d.mode === "YOU" ? "bg-human" : "bg-ai")} />
                            <span className={d.mode === "YOU" ? "text-ink" : "text-ink-2"}>{d.title}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-6 py-4">
              {aiCapable && !analysis?.mission.length ? (
                <>
                  <Button variant="ai" onClick={() => submit("run")} disabled={busy}>
                    <Play size={13} fill="currentColor" /> Run now
                  </Button>
                  <Button variant="soft" onClick={() => submit("schedule")} disabled={busy}>
                    <CalendarClock size={14} /> Schedule
                  </Button>
                  <Button variant="ghost" onClick={() => submit("me")} disabled={busy}>
                    <User size={14} /> Assign to me
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => submit("auto")} disabled={busy || !title.trim()}>
                  {analysis?.mission.length ? "Start mission" : analysis?.mode === "YOU" && analysis.aiPrep.length ? "Add — AI prepares it" : "Add task"}
                </Button>
              )}
              <span className="ml-auto hidden items-center gap-1.5 text-[11.5px] text-ink-3 sm:flex">
                <Kbd>
                  <CornerDownLeft size={10} />
                </Kbd>
                add
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function headline(analysis: ReturnType<typeof classifyTask>): string {
  if (analysis.mission.length) return "A mission: AI does the groundwork, you own the relationship.";
  if (analysis.mode === "AI") return analysis.risk === "low" ? "This can be fully automated." : "AI can do this — you approve before it ships.";
  if (analysis.mode === "AI_YOU") return "AI prepares → you decide.";
  if (analysis.mode === "WAITING") return "Blocked by someone else. I’ll monitor it.";
  return "Only you can do this.";
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card px-3 py-2.5 ring-1 ring-line">
      <div className="text-[10px] font-bold tracking-[0.12em] text-ink-3 uppercase">{label}</div>
      <div className="mt-1 text-[13.5px] font-semibold">{children}</div>
    </div>
  );
}
