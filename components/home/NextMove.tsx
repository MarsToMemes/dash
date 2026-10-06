"use client";

import clsx from "clsx";
import { Ban, Check, Clock, CornerDownRight, MapPin, Play, Sparkles, Undo2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AGENTS } from "@/lib/agents";
import { decideNow } from "@/lib/optimizer";
import { fmtClock, fmtDuration } from "@/lib/planner";
import { useWorkspace } from "../store";
import { AgentAvatar, Button, easeOut, humanIcon, ProgressLine, useMagnetic } from "../ui";

/** YOUR NEXT MOVE — the daily decision engine, rendered: do this · why · meanwhile · after. */
export function NextMove({ now }: { now: number }) {
  const { state, act, setFocusId, thinking, resolvedAt, setAddOpen, setDrawerId } = useWorkspace();
  const mag = useMagnetic<HTMLDivElement>(3);
  if (!state) return null;
  const d = decideNow(state, now);
  const move = d.move;
  const tz = state.settings.tzOffsetMin;
  const justResolved = Date.now() - resolvedAt < 1600;
  const project = move ? state.projects.find((p) => p.id === move.projectId) : null;
  const prep = move ? state.tasks.find((t) => t.parentId === move.id) : null;
  const prepJob = prep ? [...state.jobs].reverse().find((j) => j.task_id === prep.id) : null;
  const Icon = move ? humanIcon(move) : Sparkles;
  const ghost = "!text-hero-ink-2 hover:!bg-white/10 hover:!text-hero-ink";

  return (
    <motion.div ref={mag.ref} onMouseMove={mag.onMouseMove} onMouseLeave={mag.onMouseLeave} style={mag.style} className="relative h-full">
      <motion.div
        whileHover={{ y: -3 }}
        animate={justResolved ? { scale: [0.985, 1.01, 1] } : { scale: 1 }}
        transition={{ duration: 0.7, ease: easeOut }}
        className="relative h-full"
      >
        <motion.div
          layoutId={move ? `focus-${move.id}` : undefined}
          className={clsx(
            "relative flex h-full min-h-[300px] flex-col overflow-hidden rounded-[28px] bg-hero p-6 text-hero-ink sm:p-8",
            "shadow-[var(--shadow-lift)] ring-1 ring-white/5",
            move && !thinking && "breathe",
          )}
          transition={{ type: "spring", stiffness: 260, damping: 32 }}
        >
          <div className="ambient-light" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-[11px] font-bold tracking-[0.18em] text-hero-ink-2 uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-human" /> Your next move
            </div>
            {move && d.leverage && (
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-hero-ink" title="Human leverage (0–10)">
                  Human leverage <span className="tabular text-human">{d.leverage.score.toFixed(1)}</span>/10
                </span>
                {move.mode === "YOU" && (
                  <span className="rounded-full bg-human px-3 py-1.5 text-[10.5px] font-extrabold tracking-[0.14em] text-[#1b1406] uppercase">Only you</span>
                )}
              </div>
            )}
          </div>

          <div className="relative mt-auto pt-8">
            <AnimatePresence mode="wait">
              {thinking ? (
                <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <div className="text-[13px] font-semibold tracking-wide text-hero-ink-2">Chief of Staff</div>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={thinking}
                      initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                      transition={{ duration: 0.25 }}
                      className="mt-2 text-[30px] leading-tight font-semibold tracking-tight sm:text-[38px]"
                    >
                      {thinking}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              ) : move ? (
                <motion.div key={move.id} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: easeOut }}>
                  <div className="flex items-start gap-4">
                    <span className="hidden h-14 w-14 shrink-0 place-items-center rounded-2xl bg-human/15 text-human sm:grid">
                      <Icon size={24} strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold tracking-[0.16em] text-human uppercase">Do this</div>
                      <h2 className="mt-1 text-[30px] leading-[1.08] font-semibold tracking-[-0.02em] sm:text-[42px]">{move.title}</h2>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13.5px] text-hero-ink-2">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={14} /> {fmtDuration(move.humanMinutes || 5)}
                        </span>
                        {move.scheduledAt && <span>at {fmtClock(move.scheduledAt, tz)}</span>}
                        {move.location && (
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin size={14} /> {move.location}
                          </span>
                        )}
                        {project && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: project.color }} /> {project.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white/[0.06] px-4 py-3">
                      <div className="text-[10.5px] font-bold tracking-[0.14em] text-hero-ink-2 uppercase">Why</div>
                      <p className="mt-1 text-[13px] leading-snug text-hero-ink">{d.why}</p>
                    </div>
                    {d.meanwhile ? (
                      <button onClick={() => setDrawerId(d.meanwhile!.task.id)} className="flex items-start gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-left hover:bg-white/[0.09]">
                        <AgentAvatar role={d.meanwhile.agent} size={26} active={d.meanwhile.running} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10.5px] font-bold tracking-[0.14em] text-hero-ink-2 uppercase">Meanwhile I’ll do this</span>
                          <span className="mt-1 block truncate text-[13px] font-semibold">{d.meanwhile.task.title}</span>
                          <span className="block text-[11.5px] text-hero-ink-2">
                            {AGENTS[d.meanwhile.agent].name} · {d.meanwhile.minutes} min{d.meanwhile.running ? " · running" : ""}
                          </span>
                          {prep && prep.id === d.meanwhile.task.id && prepJob && prep.status !== "done" && (
                            <ProgressLine value={prepJob.progress} active={prepJob.status === "RUNNING"} className="mt-2 !bg-white/10" />
                          )}
                        </span>
                        {prep?.status === "done" && prep.id === d.meanwhile.task.id && <Check size={15} className="text-ok" />}
                      </button>
                    ) : (
                      <div className="rounded-2xl bg-white/[0.06] px-4 py-3 text-[13px] text-hero-ink-2">The AI is caught up — nothing to run in parallel.</div>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2.5">
                    <Button
                      variant="inverse"
                      size="lg"
                      onClick={() => {
                        void act({ type: "start_task", taskId: move.id });
                        setFocusId(move.id);
                      }}
                    >
                      <Play size={15} fill="currentColor" /> Start
                    </Button>
                    <Button variant="ghost" size="lg" className={ghost} onClick={() => act({ type: "complete_task", taskId: move.id })}>
                      <Check size={16} /> Done
                    </Button>
                    <Button variant="ghost" size="lg" className={ghost} onClick={() => act({ type: "postpone", taskId: move.id })}>
                      <Undo2 size={16} /> Not now
                    </Button>
                  </div>

                  <div className="mt-5 flex flex-col gap-1.5 border-t border-white/10 pt-4 text-[12.5px] text-hero-ink-2">
                    {d.after && (
                      <button onClick={() => setDrawerId(d.after!.id)} className="flex items-center gap-2 text-left hover:text-hero-ink">
                        <CornerDownRight size={13} /> <span className="font-semibold tracking-wide uppercase">After</span> {d.after.title}
                      </button>
                    )}
                    {d.dontDo && (
                      <button onClick={() => setDrawerId(d.dontDo!.task.id)} className="flex items-start gap-2 text-left hover:text-hero-ink">
                        <Ban size={13} className="mt-0.5 shrink-0 text-bad" />
                        <span>
                          <span className="font-semibold tracking-wide uppercase">Don’t</span> {d.dontDo.task.title.charAt(0).toLowerCase() + d.dontDo.task.title.slice(1)} — {d.dontDo.reason}
                        </span>
                      </button>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="text-[11px] font-bold tracking-[0.18em] text-hero-ink-2 uppercase">Nothing urgent</div>
                  <h2 className="mt-2 text-[34px] leading-tight font-semibold tracking-tight">Your workload is under control.</h2>
                  <p className="mt-2 text-[14px] text-hero-ink-2">The AI is handling what it can. Add something only you can do, or take a breath.</p>
                  <Button variant="inverse" size="lg" className="mt-6" onClick={() => setAddOpen(true)}>
                    Add a task
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
