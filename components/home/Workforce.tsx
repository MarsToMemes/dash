"use client";

import clsx from "clsx";
import { ArrowRight, GripVertical, Play } from "lucide-react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { useEffect, useState } from "react";
import { suppressedByFocus, suppressedByLeverage } from "@/lib/optimizer";
import { fmtDuration, workforce } from "@/lib/planner";
import type { Task } from "@/lib/types";
import { useWorkspace } from "../store";
import { DoneRow, TaskCard } from "../TaskCard";
import { Button, Empty, spring } from "../ui";

/** YOUR WORKFORCE — the three columns: you, the AI, and what's blocked. */
export function Workforce({ now }: { now: number }) {
  const { state, act, thinking, setView } = useWorkspace();
  if (!state) return null;
  const wf = workforce(state, now);
  // ONLY YOU radar: Maximum Leverage hides low-leverage work, Focus mutes other projects.
  const hidden = wf.you.filter((t) => suppressedByLeverage(t, state) || suppressedByFocus(t, state, now));
  const delegable = hidden.filter((t) => t.keptHuman && t.agent);
  wf.you = wf.you.filter((t) => !hidden.includes(t));
  const youMinutes = wf.you.reduce((s, t) => s + (t.humanMinutes || 5), 0);
  const running = wf.ai.filter((a) => a.job?.status === "RUNNING").length;

  // Signature moment: human work rises, AI work steps aside, blocked work recedes.
  const lane = (kind: "you" | "ai" | "waiting") =>
    thinking
      ? kind === "you"
        ? { y: -6, opacity: 1, scale: 1 }
        : kind === "ai"
          ? { y: 4, opacity: 0.55, scale: 0.985 }
          : { x: 10, opacity: 0.35, scale: 0.97 }
      : { x: 0, y: 0, opacity: 1, scale: 1 };

  return (
    <section aria-labelledby="workforce-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 id="workforce-title" className="text-[22px] font-semibold tracking-tight">Your workforce</h2>
        <button onClick={() => setView("queue")} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ai hover:underline">
          Open AI Queue <ArrowRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div animate={lane("you")} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="rounded-[26px] bg-panel p-3 ring-1 ring-line sm:p-4">
          <ColumnHead color="var(--human)" title="You" sub={`${wf.you.length} action${wf.you.length === 1 ? "" : "s"} · ${fmtDuration(youMinutes)}`} />
          <YouList tasks={wf.you} now={now} />
          {hidden.length > 0 && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-line-2 px-4 py-3 text-[12.5px] text-ink-2">
              <span className="min-w-0 flex-1">
                {hidden.length} hidden — {state.settings.maxLeverage ? "low leverage" : "outside your focus"}
              </span>
              {delegable.length > 0 && (
                <Button size="sm" variant="ai" onClick={() => act({ type: "run_all", taskIds: delegable.map((t) => t.id) })}>
                  Delegate {delegable.length}
                </Button>
              )}
            </div>
          )}
        </motion.div>

        <motion.div animate={lane("ai")} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="rounded-[26px] bg-panel p-3 ring-1 ring-line sm:p-4">
          <ColumnHead color="var(--ai)" title="AI workforce" sub={`${wf.ai.length} task${wf.ai.length === 1 ? "" : "s"} · ${running} running`} />
          <div className="flex flex-col gap-3">
            <AnimatePresence initial={false} mode="popLayout">
              {wf.ai.slice(0, 4).map(({ task, job }) => (
                <TaskCard key={task.id} task={task} job={job} now={now} variant="ai" />
              ))}
            </AnimatePresence>
            {wf.ai.length === 0 && <Empty title="AI is caught up" body="No autonomous work is running." />}
            {wf.ai.length > 4 && (
              <button onClick={() => setView("queue")} className="rounded-2xl px-3 py-2 text-left text-[12.5px] text-ink-2 hover:bg-card-2">
                + {wf.ai.length - 4} more in the queue
              </button>
            )}
            {wf.suggested.length > 0 && (
              <motion.div layout className="flex items-center gap-3 rounded-2xl border border-dashed border-ai/40 px-4 py-3">
                <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">
                  I can take <span className="font-semibold text-ink">{wf.suggested.length} more</span> task{wf.suggested.length > 1 ? "s" : ""} off your plate.
                </span>
                <Button size="sm" variant="ai" onClick={() => act({ type: "run_all", taskIds: wf.suggested.map((t) => t.id) })}>
                  <Play size={12} fill="currentColor" /> Run all
                </Button>
              </motion.div>
            )}
            {wf.recentlyDone.length > 0 && (
              <div className="mt-1">
                <div className="mb-1 px-3 text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">Completed</div>
                <AnimatePresence initial={false}>
                  {wf.recentlyDone.slice(0, 3).map(({ task }) => (
                    <DoneRow key={task.id} task={task} now={now} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div animate={lane("waiting")} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="rounded-[26px] bg-panel p-3 ring-1 ring-line sm:p-4">
          <ColumnHead color="var(--idle)" title="Waiting" sub={`${wf.waiting.length} blocked`} />
          <div className="flex flex-col gap-3">
            <AnimatePresence initial={false} mode="popLayout">
              {wf.waiting.map((t) => (
                <TaskCard key={t.id} task={t} job={null} now={now} variant="waiting" />
              ))}
            </AnimatePresence>
            {wf.waiting.length === 0 && <Empty title="Nothing blocked" body="You’re clear." />}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function ColumnHead({ color, title, sub }: { color: string; title: string; sub: string }) {
  return (
    <div className="mb-3 flex items-center justify-between px-1.5 pt-1">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[14.5px] font-semibold">{title}</span>
      </div>
      <span className="tabular text-[12px] text-ink-3">{sub}</span>
    </div>
  );
}

/** Drag to reorder your own priorities; the AI respects it until the next analysis. */
function YouList({ tasks, now }: { tasks: Task[]; now: number }) {
  const { act, state } = useWorkspace();
  const ids = tasks.map((t) => t.id).join(",");
  const [order, setOrder] = useState(tasks.map((t) => t.id));
  const [dragging, setDragging] = useState<string | null>(null);
  useEffect(() => {
    if (!dragging) setOrder(ids ? ids.split(",") : []);
  }, [ids, dragging]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visible = order.filter((id) => byId.has(id));

  if (tasks.length === 0) return <Empty title="Nothing only you can do" body="Everything open can be handled or is waiting." />;

  return (
    <Reorder.Group axis="y" values={visible} onReorder={setOrder} className="flex flex-col gap-3">
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((id) => {
          const t = byId.get(id)!;
          const job = state ? [...state.jobs].reverse().find((j) => j.task_id === id) ?? null : null;
          return (
            <Reorder.Item
              key={id}
              value={id}
              transition={spring}
              onDragStart={() => setDragging(id)}
              onDragEnd={() => {
                setDragging(null);
                void act({ type: "reorder", taskIds: order });
              }}
              whileDrag={{ scale: 1.025, boxShadow: "var(--shadow-lift)", zIndex: 10 }}
              className={clsx("relative rounded-[22px]", dragging && dragging !== id && "opacity-90")}
            >
              <span
                className="absolute top-1/2 -left-1 z-10 hidden -translate-y-1/2 cursor-grab text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:!opacity-100 lg:block"
                aria-hidden
              >
                <GripVertical size={14} />
              </span>
              <TaskCard task={t} job={job} now={now} variant="you" />
            </Reorder.Item>
          );
        })}
      </AnimatePresence>
    </Reorder.Group>
  );
}
