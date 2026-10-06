"use client";

import clsx from "clsx";
import { Check, FileText, Play, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, User, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { AGENTS } from "@/lib/agents";
import { AUTOMATION_LABEL, HUMAN_VALUE_LABEL } from "@/lib/classifier";
import { fmtClock, fmtDuration, latestJob, PIPELINE, pipelineStage } from "@/lib/planner";
import { Markdown } from "../Markdown";
import { useWorkspace } from "../store";
import { AgentAvatar, Button, easeOut, ModeBadge, ProgressLine, Tag } from "../ui";

export function TaskDrawer() {
  const { state, drawerId, setDrawerId, act, setFocusId, clock } = useWorkspace();
  const task = state?.tasks.find((t) => t.id === drawerId) ?? null;

  useEffect(() => {
    if (!drawerId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerId, setDrawerId]);

  return (
    <AnimatePresence>
      {task && state && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setDrawerId(null)}
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-label={task.title}
            initial={{ x: "100%", opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 320, damping: 36 }}
            className="fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col overflow-y-auto border-l border-line bg-app p-6 backdrop-blur-2xl sm:p-7"
          >
            <DrawerBody taskId={task.id} close={() => setDrawerId(null)} act={act} setFocusId={setFocusId} now={clock()} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerBody({
  taskId,
  close,
  act,
  setFocusId,
  now,
}: {
  taskId: string;
  close: () => void;
  act: ReturnType<typeof useWorkspace>["act"];
  setFocusId: (id: string | null) => void;
  now: number;
}) {
  const { state, setDrawerId } = useWorkspace();
  if (!state) return null;
  const task = state.tasks.find((t) => t.id === taskId)!;
  const job = latestJob(state.jobs, task.id);
  const project = state.projects.find((p) => p.id === task.projectId);
  const tz = state.settings.tzOffsetMin;
  const children = state.tasks.filter((t) => t.parentId === task.id);
  const mission = task.isMission ? task : task.parentId ? state.tasks.find((t) => t.id === task.parentId && t.isMission) : null;
  const missionSteps = mission ? state.tasks.filter((t) => t.parentId === mission.id).sort((a, b) => a.createdAt - b.createdAt) : [];
  const stage = mission ? pipelineStage(missionSteps) : null;
  const owner = task.mode === "WAITING" ? task.waitingOn ?? "External" : task.mode === "YOU" || task.keptHuman ? "You" : task.mode === "AI" ? "AI" : "AI → You";
  const involvement = task.mode === "AI" && !task.keptHuman ? (task.risk === "low" ? "None" : "Approval only") : fmtDuration(task.humanMinutes || 5);
  const open = !["done", "cancelled"].includes(task.status);
  const aiCapable = (task.mode === "AI" || task.mode === "AI_YOU") && task.agent;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ModeBadge mode={task.keptHuman ? "YOU" : task.mode} only={task.mode === "YOU"} />
          {project && <Tag className="!bg-card-2 !text-ink-2">{project.name}</Tag>}
          {task.source === "ai" && <Tag className="!bg-ai-soft !text-ai">AI-generated</Tag>}
        </div>
        <button onClick={close} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full bg-card-2 text-ink-2 hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <h2 className="mt-4 text-[26px] leading-tight font-semibold tracking-tight">{task.title}</h2>
      {task.scheduledAt && (
        <div className="mt-1 text-[13px] text-ink-3">
          {fmtClock(task.scheduledAt, tz)}
          {task.location ? ` · ${task.location}` : ""}
        </div>
      )}
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{task.reason}</p>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line">
        {[
          ["Priority", task.priority],
          ["Owner", owner],
          ["Human involvement", involvement],
          ["Expected time", task.mode === "AI" ? `${task.aiMinutes} min (AI)` : fmtDuration(task.humanMinutes || task.manualMinutes)],
          ["Automation", `${task.automation}% — ${AUTOMATION_LABEL[task.automation]}`],
          ["Human value", HUMAN_VALUE_LABEL[task.humanValue]],
        ].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3">
            <dt className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">{k}</dt>
            <dd className="mt-1 text-[14px] font-semibold capitalize">{v}</dd>
          </div>
        ))}
      </dl>

      {aiCapable && (
        <div className={clsx("mt-3 flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[13px]", task.risk === "low" ? "bg-ok/10 text-ok" : "bg-human-soft text-human")}>
          {task.risk === "low" ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          <span className="font-semibold">
            {task.risk === "low" ? "AI can do this automatically" : task.risk === "medium" ? "Your approval required before it ships" : "High risk — approval before and after"}
          </span>
        </div>
      )}

      {task.aiPrep.length > 0 && (
        <div className="mt-6">
          <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">{task.mode === "YOU" ? "AI can prepare" : "AI prepares"}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.aiPrep.map((p) => (
              <Tag key={p}>{p}</Tag>
            ))}
          </div>
        </div>
      )}

      {mission && (
        <div className="mt-6">
          <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">Mission · {mission.title}</div>
          <div className="mt-3 flex gap-1">
            {PIPELINE.map((s) => {
              const idx = PIPELINE.indexOf(s);
              const cur = stage ? PIPELINE.indexOf(stage) : -1;
              return (
                <div key={s} className="flex-1">
                  <div className={clsx("h-1.5 rounded-full", idx < cur ? "bg-ok" : idx === cur ? "bg-ai" : "bg-card-2")} />
                  <div className={clsx("mt-1.5 text-[9.5px] font-bold tracking-[0.08em] uppercase", idx === cur ? "text-ink" : "text-ink-3")}>{s}</div>
                </div>
              );
            })}
          </div>
          <ol className="mt-4 flex flex-col gap-1">
            {missionSteps.map((s, i) => (
              <li key={s.id}>
                <button onClick={() => setDrawerId(s.id)} className={clsx("flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[13px] hover:bg-card-2", s.id === task.id && "bg-card-2")}>
                  <span className="tabular w-4 text-[11.5px] text-ink-3">{i + 1}</span>
                  {s.status === "done" ? <Check size={13} className="text-ok" /> : <span className={clsx("h-2 w-2 rounded-full", s.mode === "YOU" ? "bg-human" : "bg-ai")} />}
                  <span className={clsx("min-w-0 flex-1 truncate", s.status === "done" && "text-ink-3 line-through")}>{s.title}</span>
                  <span className={clsx("text-[10px] font-bold tracking-[0.1em] uppercase", s.mode === "YOU" ? "text-human" : "text-ai")}>{s.mode === "YOU" ? "You" : "AI"}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {children.length > 0 && !task.isMission && (
        <div className="mt-6">
          <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">AI support</div>
          {children.map((c) => (
            <button key={c.id} onClick={() => setDrawerId(c.id)} className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-card-2 px-3 py-2.5 text-left">
              <AgentAvatar role={c.agent ?? "research"} size={26} active={c.status === "ai_running"} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
              <span className="text-[11px] text-ink-3">{c.status === "done" ? "Ready" : c.status.replace("ai_", "").replace("_", " ")}</span>
            </button>
          ))}
        </div>
      )}

      {job && (
        <div className="mt-6 rounded-2xl bg-card p-4 ring-1 ring-line">
          <div className="flex items-center gap-3">
            <AgentAvatar role={job.agent} size={32} active={job.status === "RUNNING"} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{AGENTS[job.agent].name}</div>
              <div className="text-[12px] text-ink-3">
                {job.status.replaceAll("_", " ").toLowerCase()} · {job.executor === "claude" ? "Claude" : "simulated"}
                {job.started_at ? ` · started ${fmtClock(job.started_at, tz)}` : ""}
              </div>
            </div>
          </div>
          {(job.status === "RUNNING" || job.status === "QUEUED") && (
            <div className="mt-3">
              <div className="mb-1.5 flex justify-between text-[12px] text-ink-2">
                <span className="shimmer-text">{job.current_step ?? "Waiting for a free agent"}</span>
                <span className="tabular">{Math.round(job.progress * 100)}%</span>
              </div>
              <ProgressLine value={job.progress} active={job.status === "RUNNING"} />
            </div>
          )}
          {job.error && <div className="mt-3 rounded-xl bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{job.error}</div>}
          {job.result && (
            <div className="mt-4 max-h-[340px] overflow-y-auto border-t border-line pt-4">
              <Markdown text={job.result} />
            </div>
          )}
          {job.artifacts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.artifacts.map((a) => (
                <span key={a} className="inline-flex items-center gap-1.5 rounded-full bg-card-2 px-2.5 py-1 text-[11.5px] text-ink-2">
                  <FileText size={12} /> {a}
                </span>
              ))}
            </div>
          )}
          {job.saved_minutes > 0 && job.status === "COMPLETED" && (
            <div className="mt-3 text-[12px] text-ok">Saved you {fmtDuration(job.saved_minutes)}</div>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-8">
        {job?.status === "WAITING_FOR_APPROVAL" && (
          <>
            <Button variant="ai" onClick={() => act({ type: "approve_job", jobId: job.id })}>
              <Check size={15} /> {job.approval_stage === "before" ? "Approve start" : "Approve"}
            </Button>
            <Button variant="soft" onClick={() => act({ type: "reject_job", jobId: job.id })}>
              Send back
            </Button>
          </>
        )}
        {open && task.status === "todo" && aiCapable && !task.keptHuman && (
          <Button variant="ai" onClick={() => act({ type: "run_task", taskId: task.id })}>
            <Play size={13} fill="currentColor" /> Run now
          </Button>
        )}
        {open && (task.keptHuman || (task.mode === "YOU" && task.aiPrep.length > 0 && children.every((c) => c.status === "done" || c.status === "cancelled") && children.length === 0)) && task.agent && (
          <Button variant="ai" onClick={() => act({ type: "delegate", taskId: task.id })}>
            <Sparkles size={14} /> {task.keptHuman ? "Delegate to AI" : "Let AI prepare"}
          </Button>
        )}
        {open && aiCapable && !task.keptHuman && task.status !== "your_turn" && (
          <Button variant="soft" onClick={() => act({ type: "assign_me", taskId: task.id })}>
            <User size={14} /> Assign to me
          </Button>
        )}
        {open && (task.mode === "YOU" || task.keptHuman || task.status === "your_turn") && (
          <>
            <Button
              variant="human"
              onClick={() => {
                void act({ type: "start_task", taskId: task.id });
                setDrawerId(null);
                setFocusId(task.id);
              }}
            >
              <Play size={13} fill="currentColor" /> Start
            </Button>
            <Button variant="soft" onClick={() => act({ type: "complete_task", taskId: task.id })}>
              <Check size={15} /> Mark done
            </Button>
          </>
        )}
        {(job?.status === "RUNNING" || job?.status === "QUEUED") && (
          <Button variant="ghost" onClick={() => act({ type: "cancel_job", jobId: job.id })}>
            Cancel run
          </Button>
        )}
        {job?.status === "FAILED" && (
          <Button variant="soft" onClick={() => act({ type: "retry_job", jobId: job.id })}>
            <RotateCcw size={14} /> Retry
          </Button>
        )}
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, ease: easeOut }} className="pt-4 text-[11.5px] text-ink-3">
        Created {new Date(task.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ·{" "}
        {task.source === "ai" ? "by your Chief of Staff" : "by you"}
      </motion.div>
    </>
  );
}
