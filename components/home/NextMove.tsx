"use client";

import clsx from "clsx";
import { Check, Clock, MapPin, Play, Sparkles, Undo2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { fmtClock, fmtDuration, nextMove } from "@/lib/planner";
import { useWorkspace } from "../store";
import { AgentAvatar, Button, easeOut, humanIcon, ProgressLine, useMagnetic } from "../ui";

/** YOUR NEXT MOVE — the heart of the interface. */
export function NextMove({ now }: { now: number }) {
  const { state, act, setFocusId, thinking, resolvedAt, setAddOpen } = useWorkspace();
  const mag = useMagnetic<HTMLDivElement>(3);
  if (!state) return null;
  const move = nextMove(state, now);
  const tz = state.settings.tzOffsetMin;
  const justResolved = Date.now() - resolvedAt < 1600;
  const project = move ? state.projects.find((p) => p.id === move.projectId) : null;
  const prep = move ? state.tasks.find((t) => t.parentId === move.id) : null;
  const prepJob = prep ? [...state.jobs].reverse().find((j) => j.task_id === prep.id) : null;
  const Icon = move ? humanIcon(move) : Sparkles;

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
          {move && (
            <span className="rounded-full bg-human px-3 py-1.5 text-[10.5px] font-extrabold tracking-[0.14em] text-[#1b1406] uppercase">
              Only you can do this
            </span>
          )}
        </div>

        <div className="relative mt-auto pt-10">
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
              <motion.div
                key={move.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.45, ease: easeOut }}
              >
                <div className="flex items-start gap-4">
                  <span className="hidden h-14 w-14 shrink-0 place-items-center rounded-2xl bg-human/15 text-human sm:grid">
                    <Icon size={24} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[30px] leading-[1.08] font-semibold tracking-[-0.02em] sm:text-[42px]">{move.title}</h2>
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
                    <p className="mt-2 max-w-xl text-[13.5px] text-hero-ink-2">{move.reason}</p>
                  </div>
                </div>

                {prep && (
                  <div className="mt-5 flex max-w-xl items-center gap-3 rounded-2xl bg-white/[0.06] px-3.5 py-2.5">
                    <AgentAvatar role={prep.agent ?? "research"} size={26} active={prepJob?.status === "RUNNING"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-semibold">
                        {prep.status === "done" ? "Your brief is ready" : "AI is preparing your brief"}
                      </div>
                      <div className="truncate text-[11.5px] text-hero-ink-2">{move.aiPrep.slice(0, 4).join(" · ")}</div>
                    </div>
                    {prep.status === "done" ? (
                      <Check size={16} className="text-ok" />
                    ) : (
                      <ProgressLine value={prepJob?.progress ?? 0} active={prepJob?.status === "RUNNING"} className="w-20 !bg-white/10" />
                    )}
                  </div>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-2.5">
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
                  <Button variant="ghost" size="lg" className="!text-hero-ink-2 hover:!bg-white/10 hover:!text-hero-ink" onClick={() => act({ type: "complete_task", taskId: move.id })}>
                    <Check size={16} /> Done
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="!text-hero-ink-2 hover:!bg-white/10 hover:!text-hero-ink"
                    onClick={() => {
                      const human = state.tasks.filter((t) => t.id !== move.id && (t.mode === "YOU" || t.status === "your_turn" || t.status === "awaiting_approval") && !["done", "cancelled"].includes(t.status));
                      const order = [...human.sort((a, b) => a.rank - b.rank).map((t) => t.id), move.id];
                      void act({ type: "reorder", taskIds: order });
                    }}
                  >
                    <Undo2 size={16} /> Not now
                  </Button>
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
