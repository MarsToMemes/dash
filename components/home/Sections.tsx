"use client";

import clsx from "clsx";
import { Bot, ChevronRight, Hourglass, Lightbulb, Play, Sparkles, User, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { AGENTS } from "@/lib/agents";
import { fmtClock, fmtDuration, isOpen, planDay, projectProgress, startOfWeek, timeSaved, workforce } from "@/lib/planner";
import type { Activity, Opportunity } from "@/lib/types";
import { useWorkspace } from "../store";
import { AGENT_ICON, AnimatedNumber, Button, easeOut, Empty, HEALTH_META, HealthDot, humanIcon, ProgressLine, SectionTitle } from "../ui";

// ---------------------------------------------------------------------------
// KPI tiles (top-row cards from the reference)

export function Kpis({ now }: { now: number }) {
  const { state, setView } = useWorkspace();
  if (!state) return null;
  const wf = workforce(state, now);
  const week = timeSaved(state.jobs, startOfWeek(now, state.settings.tzOffsetMin));
  const queued = wf.ai.filter((a) => a.job?.status === "QUEUED").length;
  const running = wf.ai.length - queued;
  const youMin = wf.you.reduce((s, t) => s + (t.humanMinutes || 5), 0);
  const followUps = state.tasks.filter((t) => t.title.startsWith("Draft follow-up") && isOpen(t)).length;

  const tiles = [
    { label: "Only you", value: wf.you.length, sub: `${fmtDuration(youMin)} of your time`, icon: User, tone: "text-human bg-human-soft", onClick: () => {} },
    { label: "AI workforce", value: wf.ai.length, sub: `${running} running · ${queued} queued`, icon: Sparkles, tone: "text-ai bg-ai-soft", onClick: () => setView("queue") },
    { label: "Waiting", value: wf.waiting.length, sub: followUps ? `${followUps} follow-up${followUps > 1 ? "s" : ""} drafted` : "Monitored by AI", icon: Hourglass, tone: "text-ink-2 bg-card-2", onClick: () => {} },
  ];
  return (
    <div className="grid h-full grid-cols-2 gap-3 [&>*]:min-w-0">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <motion.button
            key={t.label}
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={t.onClick}
            className="card flex flex-col rounded-[24px] p-4 text-left sm:p-5"
          >
            <div className="flex items-center gap-3">
              <span className={clsx("grid h-10 w-10 place-items-center rounded-xl", t.tone)}>
                <Icon size={18} strokeWidth={2.2} />
              </span>
              <span className="text-[13px] leading-tight text-ink-2">{t.label}</span>
            </div>
            <div className="mt-auto pt-5">
              <AnimatedNumber value={t.value} className="text-[34px] leading-none font-semibold tracking-tight" />
              <div className="mt-1.5 truncate text-[12px] text-ink-3">{t.sub}</div>
            </div>
          </motion.button>
        );
      })}
      <motion.button whileHover={{ y: -2 }} onClick={() => setView("insights")} className="card flex flex-col rounded-[24px] p-4 text-left sm:p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-ok/12 text-ok">
            <Zap size={18} strokeWidth={2.2} />
          </span>
          <span className="text-[13px] leading-tight text-ink-2">AI saved you</span>
        </div>
        <div className="mt-auto pt-5">
          <AnimatedNumber value={week.minutes} format={fmtDuration} duration={1.6} className="text-[30px] leading-none font-semibold tracking-tight" />
          <div className="mt-1.5 text-[12px] text-ink-3">{week.count} tasks this week</div>
        </div>
      </motion.button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI FOUND THIS — proactive missions and delegable work

export function AiFoundThis({ now }: { now: number }) {
  const { state, act, setView } = useWorkspace();
  if (!state) return null;
  const opps = state.opportunities.filter((o) => o.status === "open");
  const suggested = workforce(state, now).suggested;

  return (
    <section>
      <SectionTitle dot="var(--ai)">AI found this</SectionTitle>
      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {suggested.length > 0 && (
            <motion.div layout key="suggested" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className="card rounded-[24px] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[16px] font-semibold tracking-tight">I found {suggested.length} task{suggested.length > 1 ? "s" : ""} I can handle for you.</div>
                  <div className="mt-1 text-[12.5px] text-ink-3">
                    About {fmtDuration(suggested.reduce((s, t) => s + t.manualMinutes, 0))} of manual work · no human involvement
                  </div>
                </div>
                <Button size="sm" variant="ai" onClick={() => act({ type: "run_all", taskIds: suggested.map((t) => t.id) })}>
                  <Play size={12} fill="currentColor" /> Run all
                </Button>
              </div>
              <ol className="mt-4 flex flex-col">
                <AnimatePresence initial={false}>
                  {suggested.slice(0, 5).map((t, i) => {
                    const Icon = t.agent ? AGENT_ICON[t.agent] : Bot;
                    return (
                      <motion.li
                        key={t.id}
                        layout
                        exit={{ opacity: 0, x: 24, transition: { duration: 0.25 } }}
                        className="group flex items-center gap-3 border-t border-line py-2.5 first:border-t-0"
                      >
                        <span className="tabular w-4 text-[12px] text-ink-3">{i + 1}</span>
                        <Icon size={15} className="shrink-0 text-ai" />
                        <span className="min-w-0 flex-1 truncate text-[13.5px]">{t.title}</span>
                        <span className="hidden text-[11.5px] text-ink-3 sm:inline">~{t.aiMinutes} min</span>
                        <button onClick={() => act({ type: "run_task", taskId: t.id })} className="rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] text-ai uppercase hover:bg-ai-soft">
                          Run
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ol>
            </motion.div>
          )}
          {opps.slice(0, 2).map((o) => (
            <OpportunityCard key={o.id} o={o} />
          ))}
        </AnimatePresence>
        {opps.length > 2 && (
          <button onClick={() => setView("projects")} className="self-start rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-ai hover:bg-ai-soft">
            + {opps.length - 2} more AI-generated mission{opps.length - 2 > 1 ? "s" : ""} in Projects
          </button>
        )}
        {suggested.length === 0 && opps.length === 0 && <Empty title="Nothing new" body="I’ll surface opportunities as your projects move." />}
      </div>
    </section>
  );
}

export function OpportunityCard({ o, compact = false }: { o: Opportunity; compact?: boolean }) {
  const { state, act } = useWorkspace();
  const project = state?.projects.find((p) => p.id === o.projectId);
  const aiSteps = o.drafts.filter((d) => d.mode !== "YOU").length;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      className={clsx("rounded-[24px] p-5", compact ? "bg-card-2" : "card")}
    >
      <div className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.14em] text-ai uppercase">
        <Lightbulb size={13} /> Opportunity{project ? ` · ${project.name}` : ""}
      </div>
      <div className="mt-2 text-[16px] font-semibold tracking-tight">{o.title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{o.summary}</p>
      <ol className="mt-3 flex flex-col gap-1.5">
        {o.drafts.map((d, i) => (
          <li key={i} className="flex items-center gap-2.5 text-[13px]">
            <span className="tabular w-4 text-[12px] text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{d.title}</span>
            <span className={clsx("text-[10.5px] font-bold tracking-[0.1em] uppercase", d.mode === "YOU" ? "text-human" : "text-ai")}>
              {d.mode === "YOU" ? "You" : "AI"}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="ai" onClick={() => act({ type: "accept_opportunity", opportunityId: o.id })}>
          <Sparkles size={13} /> {aiSteps > 1 ? `Execute ${aiSteps} AI tasks` : "Do it"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act({ type: "dismiss_opportunity", opportunityId: o.id })}>
          <X size={13} /> Not now
        </Button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// TODAY — human and AI lanes on one vertical timeline

export function TodayTimeline({ now, tall = false }: { now: number; tall?: boolean }) {
  const { state, setDrawerId } = useWorkspace();
  if (!state) return null;
  const tz = state.settings.tzOffsetMin;
  const slots = planDay(state, now);
  const start = Math.floor((now - 30 * 60_000) / (30 * 60_000)) * (30 * 60_000);
  const lastEnd = Math.max(...slots.map((s) => s.end), now + 3 * 3600_000);
  const end = Math.min(lastEnd + 30 * 60_000, now + 12 * 3600_000);
  const height = tall ? 760 : 520;
  const px = (t: number) => ((t - start) / (end - start)) * height;
  const hours: number[] = [];
  for (let h = Math.ceil(start / 3600_000) * 3600_000; h <= end; h += 3600_000) hours.push(h);

  // Layout in pixel space (blocks have a minimum height), so nothing overlaps.
  const youBlocks: { slot: (typeof slots)[number]; top: number; h: number }[] = [];
  let youBottom = -Infinity;
  for (const s of slots.filter((x) => x.lane === "you")) {
    const top = Math.max(px(s.start), youBottom + 4);
    const h = Math.max(38, px(s.end) - px(s.start) - 4);
    youBlocks.push({ slot: s, top, h });
    youBottom = top + h;
  }
  // Greedy lanes so parallel AI jobs sit side by side.
  const aiSlots = slots.filter((s) => s.lane === "ai");
  const laneEnds: number[] = [];
  const aiLane = new Map<string, number>();
  for (const s of aiSlots) {
    const top = px(s.start);
    const bottom = top + Math.max(30, px(s.end) - top - 3);
    let l = laneEnds.findIndex((e) => e + 3 <= top);
    if (l === -1) l = laneEnds.length;
    laneEnds[l] = bottom;
    aiLane.set(s.task.id, l);
  }
  const lanes = Math.max(1, laneEnds.length);

  return (
    <section>
      <SectionTitle dot="var(--text-2)" right={<span className="text-[12px] text-ink-3">until {fmtClock(state.settings.dayEndMin * 60_000 + 0, 0)}</span>}>
        Today
      </SectionTitle>
      <div className="card overflow-hidden rounded-[26px] p-4 sm:p-5">
        <div className="mb-3 grid grid-cols-[52px_1fr_1fr] gap-3 text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">
          <span />
          <span className="flex items-center gap-1.5 text-human"><User size={12} /> You</span>
          <span className="flex items-center gap-1.5 text-ai"><Sparkles size={12} /> AI</span>
        </div>
        <div className="relative grid grid-cols-[52px_1fr_1fr] gap-3" style={{ height }}>
          {hours.map((h) => (
            <div key={h} className="absolute right-0 left-0 flex items-center gap-3" style={{ transform: `translateY(${px(h)}px)` }}>
              <span className="tabular w-[52px] -translate-y-1/2 text-[11px] text-ink-3">{fmtClock(h, tz)}</span>
              <span className="h-px flex-1 -translate-y-1/2 bg-line" />
            </div>
          ))}
          <div className="relative col-start-2">
            {youBlocks.map(({ slot: s, top, h }) => {
              const Icon = humanIcon(s.task);
              return (
                <motion.button
                  layout
                  key={s.task.id}
                  transition={{ type: "spring", stiffness: 260, damping: 30 }}
                  onClick={() => setDrawerId(s.task.id)}
                  className={clsx("absolute right-0 left-0 flex items-start gap-2 overflow-hidden rounded-xl px-3 py-2 text-left", s.fixed ? "bg-human text-[#1b1406]" : "bg-human-soft text-ink")}
                  style={{ top, height: h }}
                >
                  <Icon size={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold">{s.task.title}</span>
                    {h > 46 && <span className="block text-[11px] opacity-70">{fmtClock(s.start, tz)} · {fmtDuration(s.task.humanMinutes)}</span>}
                  </span>
                </motion.button>
              );
            })}
          </div>
          <div className="relative col-start-3">
            {aiSlots.map((s) => {
              const l = aiLane.get(s.task.id) ?? 0;
              const job = state.jobs.find((j) => j.task_id === s.task.id && (j.status === "RUNNING" || j.status === "QUEUED"));
              const Icon = s.task.agent ? AGENT_ICON[s.task.agent] : Bot;
              const h = Math.max(30, px(s.end) - px(s.start) - 3);
              return (
                <motion.button
                  layout
                  key={s.task.id}
                  transition={{ type: "spring", stiffness: 260, damping: 30 }}
                  onClick={() => setDrawerId(s.task.id)}
                  className="absolute flex items-start gap-1.5 overflow-hidden rounded-lg bg-ai-soft px-2 py-1.5 text-left text-ink"
                  style={{ top: px(s.start), height: h, left: `${(l / lanes) * 100}%`, width: `calc(${100 / lanes}% - 4px)` }}
                >
                  <Icon size={12} className="mt-0.5 shrink-0 text-ai" />
                  <span className="min-w-0 truncate text-[11.5px] font-medium">{s.task.title}</span>
                  {job?.status === "RUNNING" && <span className="activity-light opacity-30" />}
                </motion.button>
              );
            })}
          </div>
          {/* Now */}
          <div className="pointer-events-none absolute right-0 left-0 z-10 flex items-center transition-transform duration-1000 ease-linear" style={{ transform: `translateY(${px(now)}px)` }}>
            <span className="tabular w-[52px] -translate-y-1/2 text-[11px] font-bold text-bad">{fmtClock(now, tz)}</span>
            <span className="h-2 w-2 -translate-x-1 -translate-y-1/2 rounded-full bg-bad" />
            <span className="h-px flex-1 -translate-y-1/2 bg-bad/70" />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PROJECT PULSE — health at a glance, with contextual AI signals

export function ProjectPulse({ now }: { now: number }) {
  const { state } = useWorkspace();
  const [open, setOpen] = useState<string | null>(null);
  if (!state) return null;
  return (
    <section>
      <SectionTitle dot="var(--ok)">Project pulse</SectionTitle>
      <div className="card rounded-[26px] p-2">
        {state.projects.map((p) => {
          const opp = state.opportunities.find((o) => o.projectId === p.id && o.status === "open");
          const progress = projectProgress(p, state.tasks);
          const expanded = open === p.id && opp;
          return (
            <motion.div layout key={p.id} className="rounded-2xl">
              <button
                onClick={() => setOpen(expanded ? null : p.id)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-card-2"
                aria-expanded={Boolean(expanded)}
              >
                <HealthDot health={p.health} changedAt={p.healthChangedAt} now={now} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold">{p.name}</span>
                    {opp && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="inline-flex items-center gap-1 rounded-full bg-ai-soft px-1.5 py-0.5 text-[10px] font-bold text-ai"
                        title="AI found something"
                      >
                        <Sparkles size={10} /> 1
                      </motion.span>
                    )}
                  </span>
                  <span className="text-[11.5px] text-ink-3">{HEALTH_META[p.health].label}</span>
                </span>
                <span className="w-20">
                  <ProgressLine value={progress} tone={p.health === "on_track" ? "ok" : "ai"} />
                </span>
                <AnimatedNumber value={Math.round(progress * 100)} format={(n) => `${Math.round(n)}%`} className="w-10 text-right text-[12.5px] text-ink-2" />
                {opp && <ChevronRight size={14} className={clsx("text-ink-3 transition-transform", expanded && "rotate-90")} />}
              </button>
              <AnimatePresence initial={false}>
                {expanded && opp && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: easeOut }}
                    className="overflow-hidden px-2 pb-2"
                  >
                    <OpportunityCard o={opp} compact />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AI ACTIVITY

export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const { state, setDrawerId } = useWorkspace();
  if (!state) return null;
  const items = state.activity.slice(0, limit);
  return (
    <section>
      <SectionTitle dot="var(--text-3)">AI activity</SectionTitle>
      <div className="card rounded-[26px] p-2">
        <ul className="flex flex-col">
          <AnimatePresence initial={false}>
            {items.map((a, i) => (
              <motion.li
                key={a.id}
                layout
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: Math.max(0.45, 1 - i * 0.07), y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: easeOut }}
              >
                <button
                  onClick={() => a.taskId && setDrawerId(a.taskId)}
                  className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-card-2"
                >
                  <span className="tabular mt-0.5 w-10 shrink-0 text-[11.5px] text-ink-3">{fmtClock(a.at, state.settings.tzOffsetMin)}</span>
                  <ActorIcon a={a} />
                  <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">{a.text}</span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </section>
  );
}

function ActorIcon({ a }: { a: Activity }) {
  if (a.actor === "you") return <User size={14} className="mt-0.5 shrink-0 text-human" />;
  if (a.actor === "system") return <Sparkles size={14} className={clsx("mt-0.5 shrink-0", a.kind === "unlock" ? "text-ai" : "text-ink-3")} />;
  const Icon = AGENT_ICON[a.actor];
  return <Icon size={14} className={clsx("mt-0.5 shrink-0", a.kind === "approval" ? "text-human" : a.kind === "fail" ? "text-bad" : "text-ai")} aria-label={AGENTS[a.actor].name} />;
}
