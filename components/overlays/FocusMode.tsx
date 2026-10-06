"use client";

import { Check, Clock, MapPin, Minimize2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { fmtClock, fmtDuration, latestJob } from "@/lib/planner";
import { Markdown } from "../Markdown";
import { useNow, useWorkspace } from "../store";
import { AgentAvatar, Button, easeOut, humanIcon, ProgressLine } from "../ui";

/** FOCUS MODE — the selected task expands from where it was and becomes the interface. */
export function FocusMode() {
  const { state, focusId, setFocusId, act } = useWorkspace();
  const now = useNow(1000);
  const task = state?.tasks.find((t) => t.id === focusId) ?? null;

  useEffect(() => {
    if (!focusId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFocusId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusId, setFocusId]);

  // If the task gets completed elsewhere, leave focus gracefully.
  useEffect(() => {
    if (focusId && task && (task.status === "done" || task.status === "cancelled")) {
      const t = setTimeout(() => setFocusId(null), 900);
      return () => clearTimeout(t);
    }
  }, [focusId, task, setFocusId]);

  if (!state) return null;
  const tz = state.settings.tzOffsetMin;
  const prep = task ? state.tasks.find((t) => t.parentId === task.id) : null;
  const prepJob = prep ? latestJob(state.jobs, prep.id) : null;
  const ownJob = task ? latestJob(state.jobs, task.id) : null;
  const brief = prepJob?.result ?? (task?.status === "your_turn" || task?.status === "awaiting_approval" ? ownJob?.result : null);
  const elapsed = task?.startedAt ? Math.max(0, now - task.startedAt) : 0;
  const planned = (task?.humanMinutes || 15) * 60_000;
  const Icon = task ? humanIcon(task) : Clock;
  const done = task?.status === "done";

  return (
    <AnimatePresence>
      {task && (
        <motion.div key="focus" className="fixed inset-0 z-[55] overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { delay: 0.1 } }}>
          <motion.div className="fixed inset-0 bg-bg/70 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <div className="relative flex min-h-full items-center justify-center p-4 sm:p-8">
            <motion.div
              layoutId={`focus-${task.id}`}
              transition={{ type: "spring", stiffness: 240, damping: 30 }}
              className="relative w-full max-w-[920px] overflow-hidden rounded-[34px] bg-hero p-7 text-hero-ink shadow-[var(--shadow-lift)] sm:p-12"
            >
              <div className="ambient-light" aria-hidden />
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.5, ease: easeOut }} className="relative">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold tracking-[0.18em] text-hero-ink-2 uppercase">Focus mode</span>
                  <button onClick={() => setFocusId(null)} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] text-hero-ink-2 hover:bg-white/10 hover:text-hero-ink">
                    <Minimize2 size={14} /> Back
                  </button>
                </div>
                <div className="mt-10 flex items-start gap-5">
                  <span className="hidden h-16 w-16 shrink-0 place-items-center rounded-3xl bg-human/15 text-human sm:grid">
                    <Icon size={28} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-[36px] leading-[1.05] font-semibold tracking-[-0.025em] sm:text-[56px]">{task.title}</h1>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-hero-ink-2">
                      <span className="inline-flex items-center gap-1.5"><Clock size={15} /> {fmtDuration(task.humanMinutes || 15)}</span>
                      {task.scheduledAt && <span>at {fmtClock(task.scheduledAt, tz)}</span>}
                      {task.location && <span className="inline-flex items-center gap-1.5"><MapPin size={15} /> {task.location}</span>}
                    </div>
                    {task.notes && <p className="mt-4 max-w-2xl text-[15px] text-hero-ink">{task.notes}</p>}
                  </div>
                </div>

                <div className="mt-10">
                  <div className="mb-2 flex justify-between text-[12.5px] text-hero-ink-2">
                    <span className="tabular">{fmtDuration(elapsed / 60_000)} in</span>
                    <span className="tabular">{elapsed > planned ? `${fmtDuration((elapsed - planned) / 60_000)} over` : `${fmtDuration((planned - elapsed) / 60_000)} left`}</span>
                  </div>
                  <ProgressLine value={Math.min(1, elapsed / planned)} tone="human" className="!h-2 !bg-white/10" />
                </div>

                {(prep || brief) && (
                  <div className="mt-8 rounded-3xl bg-white/[0.06] p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      {prep?.agent && <AgentAvatar role={prep.agent} size={30} active={prepJob?.status === "RUNNING"} />}
                      <div className="text-[13.5px] font-semibold">
                        {brief ? "Prepared by your AI workforce" : "AI is still preparing your brief…"}
                      </div>
                    </div>
                    {!brief && prepJob && <ProgressLine value={prepJob.progress} active className="mt-4 !bg-white/10" />}
                    {brief && (
                      <div className="mt-4 max-h-[38vh] overflow-y-auto [&_*]:!text-hero-ink-2 [&_strong]:!text-hero-ink">
                        <Markdown text={brief} />
                      </div>
                    )}
                    {!brief && task.aiPrep.length > 0 && <div className="mt-3 text-[13px] text-hero-ink-2">{task.aiPrep.join(" · ")}</div>}
                  </div>
                )}

                <div className="mt-10 flex flex-wrap items-center gap-3">
                  <Button variant="human" size="lg" disabled={done} onClick={() => act({ type: "complete_task", taskId: task.id })}>
                    <Check size={17} /> {done ? "Done" : task.status === "awaiting_approval" ? "Approve & done" : "Mark done"}
                  </Button>
                  <Button variant="ghost" size="lg" className="!text-hero-ink-2 hover:!bg-white/10 hover:!text-hero-ink" onClick={() => setFocusId(null)}>
                    Leave focus
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
