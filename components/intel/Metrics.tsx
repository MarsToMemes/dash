"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Gauge, Target, User, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AGENTS } from "@/lib/agents";
import {
  focusPlan,
  humanLeverage,
  humanLeverageKpi,
  isParked,
  projectMomentum,
  savedSummary,
  workflowEfficiency,
} from "@/lib/optimizer";
import { fmtDuration, isHumanAction, isOpen } from "@/lib/planner";
import { useWorkspace } from "../store";
import { AgentAvatar, AnimatedNumber, Button, Empty, Eyebrow, ProgressLine, SectionTitle } from "../ui";

/** WHILE YOU WORK — the agents running in parallel right now. */
export function WhileYouWork() {
  const { state, setDrawerId, setView } = useWorkspace();
  if (!state) return null;
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const running = state.jobs.filter((j) => j.status === "RUNNING");
  const queued = state.jobs.filter((j) => j.status === "QUEUED").length;
  return (
    <div className="card flex h-full flex-col rounded-[28px] p-5">
      <div className="flex items-center justify-between">
        <Eyebrow>While you work</Eyebrow>
        <span className="tabular text-[11.5px] text-ink-3">{running.length} running · {queued} queued</span>
      </div>
      <ul className="mt-3 flex flex-1 flex-col gap-1">
        <AnimatePresence initial={false}>
          {running.slice(0, 4).map((j) => {
            const t = byId.get(j.task_id);
            if (!t) return null;
            return (
              <motion.li key={j.id} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
                <button onClick={() => setDrawerId(t.id)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-card-2">
                  <AgentAvatar role={j.agent} size={32} active />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{t.title}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">
                      {AGENTS[j.agent].name} · <span className="shimmer-text">{j.current_step}</span>
                    </span>
                    <ProgressLine value={j.progress} active className="mt-1.5" />
                  </span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {running.length === 0 && <Empty title="AI is caught up" body="No autonomous work is running." />}
      </ul>
      <button onClick={() => setView("queue")} className="mt-2 self-start rounded-full px-2 py-1 text-[12px] font-semibold text-ai hover:bg-ai-soft">
        Open AI Queue →
      </button>
    </div>
  );
}

/** The four numbers that matter: time back, leverage, efficiency, what only you can do. */
export function MetricTiles({ now }: { now: number }) {
  const { state, setView } = useWorkspace();
  if (!state) return null;
  const saved = savedSummary(state, now);
  const lev = humanLeverageKpi(state, now - 7 * 86_400_000);
  const eff = workflowEfficiency(state, now);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const only = state.tasks.filter((t) => isOpen(t) && isHumanAction(t, byId) && humanLeverage(t, state.projects.find((p) => p.id === t.projectId) ?? null).score >= 7);
  const delta = eff.previous !== null ? eff.score - eff.previous : 0;

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
      <motion.button whileHover={{ y: -2 }} onClick={() => setView("insights")} className="card rounded-[24px] p-5 text-left">
        <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ok/12 text-ok"><Zap size={17} /></span> AI saved you
        </div>
        <AnimatedNumber value={saved.today.minutes} format={fmtDuration} duration={1.6} className="mt-4 block text-[32px] leading-none font-semibold tracking-tight" />
        <div className="mt-1.5 text-[12px] text-ink-3">
          today · {fmtDuration(saved.week.minutes)} this week · {fmtDuration(saved.month.minutes)} this month
        </div>
      </motion.button>

      <motion.button whileHover={{ y: -2 }} onClick={() => setView("insights")} className="card rounded-[24px] p-5 text-left">
        <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-human-soft text-human"><Target size={17} /></span> Human leverage
        </div>
        <div className="mt-4 text-[32px] leading-none font-semibold tracking-tight">
          {lev.pct === null ? "—" : <AnimatedNumber value={lev.pct} format={(n) => `${Math.round(n)}%`} />}
        </div>
        <div className="mt-1.5 text-[12px] text-ink-3">
          {lev.pct === null ? "No human work logged in the last 7 days" : `of your time (7 days) went to work that needed you${lev.wastedMinutes ? ` · ${fmtDuration(lev.wastedMinutes)} delegable` : ""}`}
        </div>
      </motion.button>

      <motion.button whileHover={{ y: -2 }} onClick={() => setView("insights")} className="card rounded-[24px] p-5 text-left">
        <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ai-soft text-ai"><Gauge size={17} /></span> Workflow efficiency
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <AnimatedNumber value={eff.score} className="text-[32px] leading-none font-semibold tracking-tight" />
          <span className="text-[13px] text-ink-3">/ 100</span>
          {eff.previous !== null && delta !== 0 && (
            <span className={clsx("inline-flex items-center text-[12px] font-semibold", delta > 0 ? "text-ok" : "text-bad")}>
              {delta > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {eff.previous} → {eff.score}
            </span>
          )}
        </div>
        <div className="mt-1.5 line-clamp-2 text-[12px] text-ink-3">{eff.reason}</div>
      </motion.button>

      <div className="card rounded-[24px] p-5">
        <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-human-soft text-human"><User size={17} /></span> Only you
        </div>
        <AnimatedNumber value={only.length} className="mt-4 block text-[32px] leading-none font-semibold tracking-tight" />
        <div className="mt-1.5 text-[12px] text-ink-3">high-leverage missions waiting for you</div>
      </div>
    </div>
  );
}

/** PROJECT FOCUS MODE banner: goal, what's left for you and for the AI, time to milestone. */
export function FocusBanner({ now }: { now: number }) {
  const { state, act } = useWorkspace();
  const f = state?.settings.focus;
  if (!state || !f || f.until <= now) return null;
  const plan = focusPlan(state, f.projectId, now);
  if (!plan) return null;
  const daysLeft = Math.max(1, Math.ceil((f.until - now) / 86_400_000));
  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-[28px] bg-ai-soft p-5 ring-1 ring-ai/30 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow className="!text-ai">Focus · {daysLeft} day{daysLeft > 1 ? "s" : ""} left</Eyebrow>
          <h2 className="mt-1 text-[24px] font-semibold tracking-tight">{plan.project.name}</h2>
          <p className="text-[13.5px] text-ink-2">Goal: {plan.goal ?? "finish what matters"}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => act({ type: "exit_focus" })}>
          <X size={14} /> End focus
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {[
          ["You", `${plan.human.length}`, "missions"],
          ["AI", `${plan.ai.length}`, "missions"],
          ["Blocked", `${plan.blocked.length}`, ""],
          ["Your time", fmtDuration(plan.humanMinutes), ""],
          ["AI time", fmtDuration(plan.aiMinutes), plan.aiWallMinutes < plan.aiMinutes ? `${fmtDuration(plan.aiWallMinutes)} in parallel` : ""],
          ["To milestone", `~${fmtDuration(plan.timeToMilestone)}`, "if you start now"],
        ].map(([k, v, sub]) => (
          <div key={k} className="rounded-2xl bg-card px-3 py-2.5 ring-1 ring-line">
            <Eyebrow>{k}</Eyebrow>
            <div className="tabular mt-1 text-[18px] font-semibold">{v}</div>
            {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
          </div>
        ))}
      </div>
      {plan.human.length > 0 && (
        <ol className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
          {plan.human.slice(0, 4).map((t, i) => (
            <li key={t.id}>
              <span className="tabular text-ink-3">{i + 1}.</span> {t.title}
            </li>
          ))}
        </ol>
      )}
    </motion.section>
  );
}

/** PROJECT MOMENTUM — not just % done: is it moving, and how fast? */
export function ProjectMomentumList({ now }: { now: number }) {
  const { state, setView } = useWorkspace();
  if (!state) return null;
  const rows = state.projects
    .map((p) => ({ p, m: projectMomentum(p, state, now) }))
    .sort((a, b) => Number(isParked(a.p, now)) - Number(isParked(b.p, now)) || b.m.score - a.m.score);
  const labelTone = { accelerating: "text-ok", steady: "text-ai", slowing: "text-warn", stalled: "text-bad", paused: "text-ink-3", done: "text-ink-3" };
  return (
    <section>
      <SectionTitle dot="var(--ok)">Project momentum</SectionTitle>
      <div className="card rounded-[26px] p-2">
        {rows.map(({ p, m }) => (
          <button key={p.id} onClick={() => setView("projects")} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-card-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{p.name}</span>
              <span className={clsx("block text-[11.5px] capitalize", labelTone[m.label])}>
                {m.label}
                <span className="text-ink-3 normal-case"> · {Math.round(m.progress * 100)}% done{m.reasons[0] ? ` · ${m.reasons[0]}` : ""}</span>
              </span>
            </span>
            <span className="w-24">
              <ProgressLine value={m.score / 100} tone={m.label === "accelerating" ? "ok" : "ai"} />
            </span>
            <AnimatedNumber value={m.score} className="w-8 text-right text-[12.5px] text-ink-2" />
          </button>
        ))}
      </div>
    </section>
  );
}

