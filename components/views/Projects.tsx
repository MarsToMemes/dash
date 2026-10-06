"use client";

import clsx from "clsx";
import { Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { isOpen, PIPELINE, pipelineStage, projectProgress } from "@/lib/planner";
import type { Task } from "@/lib/types";
import { OpportunityCard } from "../home/Sections";
import { useNow, useWorkspace } from "../store";
import { AnimatedNumber, enter, HEALTH_META, HealthDot, SectionTitle } from "../ui";

function Ring({ value, color }: { value: number; color: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90" aria-hidden>
      <circle cx="28" cy="28" r={r} stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" fill="none" />
      <motion.circle
        cx="28" cy="28" r={r} stroke={color} strokeWidth="4" fill="none" strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - value) }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

function Pipeline({ tasks }: { tasks: Task[] }) {
  const stage = pipelineStage(tasks);
  const cur = PIPELINE.indexOf(stage);
  return (
    <div>
      <div className="flex gap-1">
        {PIPELINE.map((s, i) => (
          <motion.div key={s} className={clsx("h-1.5 flex-1 rounded-full", i < cur ? "bg-ok" : i === cur ? "bg-ai" : "bg-white/12")} layout />
        ))}
      </div>
      <div className="mt-2 text-[10.5px] font-bold tracking-[0.14em] uppercase opacity-80">{stage}</div>
    </div>
  );
}

export function Projects() {
  const now = useNow(2000);
  const { state, setDrawerId } = useWorkspace();
  if (!state) return null;
  const missions = state.tasks.filter((t) => t.isMission);

  return (
    <motion.div initial="hidden" animate="show" className="flex flex-col gap-8 pt-6 lg:pt-8">
      <motion.div variants={enter} custom={0}>
        <div className="text-[13.5px] text-ink-3">Every project, one pipeline: idea → AI prep → your review → your action → AI follow-up → done</div>
        <h1 className="mt-2 text-[44px] leading-none font-semibold tracking-[-0.03em] sm:text-[60px]">Projects</h1>
      </motion.div>

      <motion.div variants={enter} custom={1} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {state.projects.map((p) => {
          const mine = state.tasks.filter((t) => t.projectId === p.id && !t.isMission);
          const open = mine.filter(isOpen);
          const progress = projectProgress(p, state.tasks);
          const you = open.filter((t) => t.mode === "YOU" || t.status === "your_turn" || t.status === "awaiting_approval").length;
          const ai = open.filter((t) => (t.mode === "AI" || t.mode === "AI_YOU") && t.status !== "your_turn" && t.status !== "awaiting_approval").length;
          const waiting = open.filter((t) => t.status === "waiting").length;
          const opp = state.opportunities.find((o) => o.projectId === p.id && o.status === "open");
          return (
            <motion.article key={p.id} layout whileHover={{ y: -3 }} className="relative overflow-hidden rounded-[28px] bg-hero p-6 text-hero-ink shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <HealthDot health={p.health} changedAt={p.healthChangedAt} now={now} />
                    <span className="text-[12px] text-hero-ink-2">{HEALTH_META[p.health].label} · {p.stage}</span>
                  </div>
                  <h2 className="mt-2 text-[22px] font-semibold tracking-tight">{p.name}</h2>
                  <p className="mt-1 text-[12.5px] text-hero-ink-2">{p.description}</p>
                </div>
                <div className="relative grid place-items-center">
                  <Ring value={progress} color={p.color} />
                  <AnimatedNumber value={Math.round(progress * 100)} format={(n) => `${Math.round(n)}%`} className="absolute text-[11.5px] font-semibold" />
                </div>
              </div>
              <div className="mt-6">
                <Pipeline tasks={mine} />
              </div>
              <div className="mt-5 flex gap-5 text-[12.5px] text-hero-ink-2">
                <span><b className="text-human">{you}</b> you</span>
                <span><b className="text-ai">{ai}</b> AI</span>
                <span><b className="text-hero-ink">{waiting}</b> waiting</span>
              </div>
              {opp && (
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-[12.5px]">
                  <Sparkles size={13} className="text-ai" />
                  <span className="truncate">{opp.title}</span>
                </div>
              )}
            </motion.article>
          );
        })}
      </motion.div>

      {missions.length > 0 && (
        <motion.section variants={enter} custom={2}>
          <SectionTitle dot="var(--ai)" count={missions.length}>Missions</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {missions.map((m) => {
              const steps = state.tasks.filter((t) => t.parentId === m.id).sort((a, b) => a.createdAt - b.createdAt);
              const done = steps.filter((s) => s.status === "done").length;
              return (
                <button key={m.id} onClick={() => setDrawerId(steps.find(isOpen)?.id ?? m.id)} className="card rounded-[24px] p-5 text-left">
                  <div className="flex items-center justify-between">
                    <div className="text-[16px] font-semibold">{m.title}</div>
                    <span className="tabular text-[12px] text-ink-3">{done}/{steps.length}</span>
                  </div>
                  <div className="mt-4 flex gap-1">
                    {steps.map((s) => (
                      <span
                        key={s.id}
                        title={s.title}
                        className={clsx("h-2 flex-1 rounded-full", s.status === "done" ? "bg-ok" : s.mode === "YOU" ? "bg-human/40" : s.status === "ai_running" ? "bg-ai" : "bg-ai/30")}
                      />
                    ))}
                  </div>
                  <div className="mt-2 text-[12px] text-ink-3">{pipelineStage(steps)}</div>
                </button>
              );
            })}
          </div>
        </motion.section>
      )}

      {state.opportunities.some((o) => o.status === "open") && (
        <motion.section variants={enter} custom={3}>
          <SectionTitle dot="var(--ai)">AI-generated missions</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {state.opportunities.filter((o) => o.status === "open").map((o) => (
              <OpportunityCard key={o.id} o={o} />
            ))}
          </div>
        </motion.section>
      )}
    </motion.div>
  );
}
