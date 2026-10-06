"use client";

import clsx from "clsx";
import { Bot, Lightbulb, Pencil, Sparkles, User, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { AGENTS } from "@/lib/agents";
import { fmtClock, fmtDuration, planDay } from "@/lib/planner";
import type { Activity, Opportunity } from "@/lib/types";
import { useWorkspace } from "../store";
import { AGENT_ICON, Button, easeOut, humanIcon, SectionTitle } from "../ui";

/** AI-GENERATED MISSION: accept, dismiss, or modify (keep only the steps you want). */
export function OpportunityCard({ o, compact = false }: { o: Opportunity; compact?: boolean }) {
  const { state, act } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [keep, setKeep] = useState<Set<number>>(() => new Set(o.drafts.map((_, i) => i)));
  const project = state?.projects.find((p) => p.id === o.projectId);
  const kept = o.drafts.filter((_, i) => keep.has(i));
  const aiSteps = kept.filter((d) => d.mode !== "YOU").length;
  const saved = kept.filter((d) => d.mode !== "YOU" && d.agent).reduce((s, d) => s + AGENTS[d.agent!].manualMinutes, 0);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      className={clsx("rounded-[24px] p-5", compact ? "bg-card-2" : "card")}
    >
      <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-bold tracking-[0.14em] uppercase">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ai-soft px-2 py-1 text-ai">
          <Bot size={12} /> AI generated
        </span>
        <span className="text-ink-3">
          <Lightbulb size={12} className="mr-1 inline" />
          Opportunity{project ? ` · ${project.name}` : ""}
        </span>
      </div>
      <div className="mt-2 text-[16px] font-semibold tracking-tight">{o.title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{o.summary}</p>
      <ol className="mt-3 flex flex-col gap-1.5">
        {o.drafts.map((d, i) => (
          <li key={i} className={clsx("flex items-center gap-2.5 text-[13px]", !keep.has(i) && "text-ink-3 line-through")}>
            {editing ? (
              <input
                type="checkbox"
                aria-label={`Keep ${d.title}`}
                checked={keep.has(i)}
                onChange={() =>
                  setKeep((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
                className="h-4 w-4 accent-[var(--ai)]"
              />
            ) : (
              <span className="tabular w-4 text-[12px] text-ink-3">{i + 1}</span>
            )}
            <span className="min-w-0 flex-1 truncate">{d.title}</span>
            <span className={clsx("text-[10.5px] font-bold tracking-[0.1em] uppercase", d.mode === "YOU" ? "text-human" : "text-ai")}>
              {d.mode === "YOU" ? "You" : "AI"}
            </span>
          </li>
        ))}
      </ol>
      {saved > 0 && <div className="mt-3 text-[12px] text-ink-3">Estimated human time saved: {fmtDuration(saved)}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ai"
          disabled={kept.length === 0}
          onClick={() => act({ type: "accept_opportunity", opportunityId: o.id, include: keep.size === o.drafts.length ? undefined : [...keep] })}
        >
          <Sparkles size={13} /> {editing ? "Accept selection" : aiSteps > 2 ? "Prepare everything" : aiSteps > 1 ? `Execute ${aiSteps} AI tasks` : "Accept"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
          <Pencil size={13} /> {editing ? "Done editing" : "Modify"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act({ type: "dismiss_opportunity", opportunityId: o.id })}>
          <X size={13} /> Dismiss
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
