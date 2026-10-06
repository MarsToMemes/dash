"use client";

import clsx from "clsx";
import { Check, Pause, Play, ShieldAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AGENTS } from "@/lib/agents";
import { agentLoad, fmtClock, fmtDuration, startOfToday } from "@/lib/planner";
import type { AgentJob, Task } from "@/lib/types";
import { ActivityFeed } from "../home/Sections";
import { useNow, useWorkspace } from "../store";
import { AgentAvatar, Button, Empty, enter, Morph, ProgressLine, SectionTitle, spring, Toggle } from "../ui";

/** AI QUEUE — the control center of the workforce. */
export function Queue() {
  const now = useNow(1000);
  const { state, act } = useWorkspace();
  if (!state) return null;
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const pair = (j: AgentJob) => ({ job: j, task: byId.get(j.task_id) }) as { job: AgentJob; task: Task | undefined };
  const running = state.jobs.filter((j) => j.status === "RUNNING").map(pair);
  const queued = state.jobs
    .filter((j) => j.status === "QUEUED")
    .sort((a, b) => a.created_at - b.created_at)
    .map(pair);
  const approvals = state.jobs.filter((j) => j.status === "WAITING_FOR_APPROVAL").map(pair);
  const failed = state.jobs.filter((j) => j.status === "FAILED").map(pair);
  const doneToday = state.jobs
    .filter((j) => j.status === "COMPLETED" && (j.completed_at ?? 0) >= startOfToday(now, state.settings.tzOffsetMin))
    .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0))
    .map(pair);
  const load = agentLoad(state.jobs);
  const autopilotLoad = state.jobs.filter((j) => j.status === "RUNNING" || j.status === "QUEUED");

  return (
    <motion.div initial="hidden" animate="show" className="flex flex-col gap-8 pt-6 lg:pt-8">
      <motion.div variants={enter} custom={0} className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[13.5px] text-ink-3">Control center</div>
          <h1 className="mt-2 text-[44px] leading-none font-semibold tracking-[-0.03em] sm:text-[60px]">AI Queue</h1>
        </div>
        <div className={clsx("flex items-center gap-4 rounded-[22px] px-5 py-4 ring-1", state.settings.autopilot ? "bg-ai-soft ring-ai/30" : "bg-card ring-line")}>
          <div>
            <div className="text-[11px] font-extrabold tracking-[0.16em] uppercase">
              <Morph value={state.settings.autopilot ? "Autopilot active" : "Autopilot off"} />
            </div>
            <div className="mt-0.5 text-[12.5px] text-ink-2">
              {state.settings.autopilot ? `Handling ${autopilotLoad.length} task${autopilotLoad.length === 1 ? "" : "s"} · low-risk only` : "AI waits for your go on new work"}
            </div>
          </div>
          <Toggle on={state.settings.autopilot} onChange={(on) => act({ type: "set_autopilot", on })} label="Autopilot" />
        </div>
      </motion.div>

      <motion.section variants={enter} custom={1}>
        <SectionTitle>AI workforce</SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {load.map(({ agent, running: r, queued: q }) => {
            const t = r ? byId.get(r.task_id) : null;
            return (
              <div key={agent.role} className={clsx("card rounded-[22px] p-4 transition-colors", r && "ring-1 ring-ai/30")}>
                <div className="flex items-center justify-between">
                  <AgentAvatar role={agent.role} size={34} active={Boolean(r)} />
                  <span className={clsx("text-[10.5px] font-bold tracking-[0.12em] uppercase", r ? "text-ok" : "text-ink-3")}>{r ? "● Running" : "○ Idle"}</span>
                </div>
                <div className="mt-3 text-[13.5px] font-semibold">{agent.name}</div>
                <div className="mt-0.5 h-8 text-[11.5px] leading-tight text-ink-3">{t ? t.title : agent.handles}</div>
                <div className="mt-2">
                  <ProgressLine value={r?.progress ?? 0} active={Boolean(r)} />
                </div>
                <div className="mt-2 text-[11px] text-ink-3">{q ? `${q} queued` : "Nothing queued"}</div>
              </div>
            );
          })}
        </div>
      </motion.section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <motion.div variants={enter} custom={2} className="flex flex-col gap-6 xl:col-span-7">
          <Lane title="Running" dot="var(--ok)" count={running.length} empty={["AI is caught up", "No autonomous work is running."]}>
            {running.map(({ job, task }) => task && <JobRow key={job.id} job={job} task={task} now={now} />)}
          </Lane>
          <Lane title="Waiting for you" dot="var(--human)" count={approvals.length} empty={["Nothing to approve", "The AI isn’t blocked on you."]}>
            {approvals.map(({ job, task }) => task && <ApprovalRow key={job.id} job={job} task={task} />)}
          </Lane>
          <Lane title="Next" dot="var(--ai)" count={queued.length} empty={["Queue empty", "Delegate something, or turn on autopilot."]}>
            {queued.map(({ job, task }, i) => task && <JobRow key={job.id} job={job} task={task} now={now} next={i === 0} />)}
          </Lane>
          {failed.length > 0 && (
            <Lane title="Failed" dot="var(--bad)" count={failed.length} empty={["", ""]}>
              {failed.map(({ job, task }) => task && <FailedRow key={job.id} job={job} task={task} />)}
            </Lane>
          )}
        </motion.div>
        <motion.div variants={enter} custom={3} className="flex flex-col gap-6 xl:col-span-5">
          <Lane title="Completed today" dot="var(--text-3)" count={doneToday.length} empty={["Nothing yet today", "Completed work lands here."]}>
            {doneToday.slice(0, 8).map(({ job, task }) => task && (
              <motion.div layout key={job.id} className="flex items-center gap-3 px-1 py-1.5">
                <Check size={15} className="text-ok" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{task.title}</span>
                <span className="text-[11.5px] text-ok">+{fmtDuration(job.saved_minutes)}</span>
              </motion.div>
            ))}
          </Lane>
          <ActivityFeed limit={12} />
        </motion.div>
      </div>
    </motion.div>
  );
}

function Lane({ title, dot, count, empty, children }: { title: string; dot: string; count: number; empty: [string, string]; children: React.ReactNode }) {
  return (
    <section>
      <SectionTitle dot={dot} count={count}>
        {title}
      </SectionTitle>
      <div className="card rounded-[24px] p-3">
        <AnimatePresence initial={false} mode="popLayout">
          {count === 0 ? <Empty key="empty" title={empty[0]} body={empty[1]} /> : children}
        </AnimatePresence>
      </div>
    </section>
  );
}

function JobRow({ job, task, now, next }: { job: AgentJob; task: Task; now: number; next?: boolean }) {
  const { act, setDrawerId, state } = useWorkspace();
  const running = job.status === "RUNNING";
  const tz = state?.settings.tzOffsetMin ?? 0;
  return (
    <motion.div
      layout
      layoutId={`job-${job.id}`}
      transition={spring}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 30 }}
      className="group flex items-center gap-3.5 rounded-2xl px-3 py-3 hover:bg-card-2"
    >
      <AgentAvatar role={job.agent} size={34} active={running} />
      <button className="min-w-0 flex-1 text-left" onClick={() => setDrawerId(task.id)}>
        <div className="truncate text-[14px] font-semibold">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-3">
          <span>{AGENTS[job.agent].short}</span>·
          {running ? (
            <span className="shimmer-text truncate">{job.current_step}</span>
          ) : (
            <span>
              {next ? "Up next" : "Queued"} · est. {task.aiMinutes} min
              {job.scheduled_for && job.scheduled_for > now ? ` · at ${fmtClock(job.scheduled_for, tz)}` : ""}
            </span>
          )}
        </div>
        {running && (
          <div className="mt-2 flex items-center gap-3">
            <ProgressLine value={job.progress} active className="flex-1" />
            <span className="tabular w-9 text-right text-[12px] text-ink-2">{Math.floor(job.progress * 100)}%</span>
          </div>
        )}
      </button>
      {running && job.started_at && <span className="tabular hidden text-[11.5px] text-ink-3 sm:inline">since {fmtClock(job.started_at, tz)}</span>}
      <button
        aria-label="Cancel"
        onClick={() => act({ type: "cancel_job", jobId: job.id })}
        className="grid h-8 w-8 place-items-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-card hover:text-ink focus:opacity-100"
      >
        {running ? <Pause size={14} /> : <X size={14} />}
      </button>
    </motion.div>
  );
}

function ApprovalRow({ job, task }: { job: AgentJob; task: Task }) {
  const { act, setDrawerId } = useWorkspace();
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className="flex flex-wrap items-center gap-3.5 rounded-2xl px-3 py-3">
      <AgentAvatar role={job.agent} size={34} />
      <button className="min-w-0 flex-1 text-left" onClick={() => setDrawerId(task.id)}>
        <div className="truncate text-[14px] font-semibold">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-human">
          <ShieldAlert size={12} /> {job.approval_stage === "before" ? "High risk — approve before it starts" : "Ready — your approval required"}
        </div>
      </button>
      <div className="flex gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setDrawerId(task.id)}>
          Review
        </Button>
        <Button size="sm" variant="ai" onClick={() => act({ type: "approve_job", jobId: job.id })}>
          <Check size={13} /> Approve
        </Button>
      </div>
    </motion.div>
  );
}

function FailedRow({ job, task }: { job: AgentJob; task: Task }) {
  const { act } = useWorkspace();
  return (
    <div className="flex items-center gap-3.5 rounded-2xl px-3 py-3">
      <AgentAvatar role={job.agent} size={34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{task.title}</div>
        <div className="truncate text-[12px] text-bad">{job.error}</div>
      </div>
      <Button size="sm" variant="soft" onClick={() => act({ type: "retry_job", jobId: job.id })}>
        <Play size={12} /> Retry
      </Button>
    </div>
  );
}
