"use client";

import clsx from "clsx";
import { ArrowRight, Check, Clock, CornerDownRight, Hourglass, MapPin, Play, Sparkles, Unlock, User, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AGENTS } from "@/lib/agents";
import { humanLeverage } from "@/lib/optimizer";
import { fmtClock, fmtDuration } from "@/lib/planner";
import type { AgentJob, Task } from "@/lib/types";
import { useWorkspace } from "./store";
import { AgentAvatar, Button, CheckDraw, Chip, humanIcon, LeverageBadge, Morph, ProgressLine, spring, Tag } from "./ui";

const RECENT = 8000;

/** Plays a short status sequence after a delegation: OWNER: YOU → OWNER: AI → AGENT → state. */
function useDelegationSequence(task: Task, job: AgentJob | null, now: number): string | null {
  const { clock } = useWorkspace();
  const [, force] = useState(0);
  const since = task.delegatedAt ? now - task.delegatedAt : Infinity;
  const active = since < 2600;
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(iv);
  }, [active]);
  if (!active || !task.agent) return null;
  const elapsed = clock() - (task.delegatedAt ?? 0);
  const steps = ["Owner: You", "Owner: AI", `Agent: ${AGENTS[task.agent].short}`, job?.status === "RUNNING" ? "Running" : "Queued"];
  return steps[Math.min(steps.length - 1, Math.floor(Math.max(0, elapsed) / 600))];
}

export function TaskCard({ task, job, now, variant }: { task: Task; job: AgentJob | null; now: number; variant: "you" | "ai" | "waiting" | "suggested" }) {
  const { setDrawerId } = useWorkspace();
  const project = useProjectName(task.projectId);
  const unlocked = task.unlockedAt !== null && now - task.unlockedAt < RECENT;
  const handoff = task.handoffAt !== null && now - task.handoffAt < RECENT;

  return (
    <motion.article
      layout="position"
      layoutId={`card-${task.id}`}
      transition={spring}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      whileHover={{ y: -2 }}
      onClick={() => setDrawerId(task.id)}
      className={clsx(
        "group relative cursor-pointer rounded-[22px] p-4 sm:p-5",
        "bg-card ring-1 ring-line transition-shadow hover:shadow-[var(--shadow-lift)]",
        variant === "you" && task.humanValue >= 5 && "breathe",
        unlocked && "ring-2 ring-ai/60",
      )}
    >
      {unlocked && <UnlockedBanner from={task.unlockedBy} />}
      {variant === "you" && <YouBody task={task} job={job} project={project} now={now} handoff={handoff} />}
      {variant === "ai" && <AiBody task={task} job={job} project={project} now={now} />}
      {variant === "waiting" && <WaitingBody task={task} project={project} now={now} />}
      {variant === "suggested" && <AiBody task={task} job={null} project={project} now={now} />}
    </motion.article>
  );
}

function useProjectName(id: string | null) {
  const { state } = useWorkspace();
  return state?.projects.find((p) => p.id === id) ?? null;
}

function UnlockedBanner({ from }: { from: string | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mb-3 overflow-hidden"
    >
      <div className="flex items-center gap-2 text-[11.5px] text-ink-2">
        <Check size={13} className="text-ok" />
        <span className="truncate">{from}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.14em] text-ai uppercase">
        <Unlock size={12} /> Newly unlocked
      </div>
    </motion.div>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">{children}</span>;
}

function YouBody({ task, job, project, now, handoff }: { task: Task; job: AgentJob | null; project: { name: string; color: string } | null; now: number; handoff: boolean }) {
  const { act, setFocusId, state } = useWorkspace();
  const Icon = humanIcon(task);
  const approval = task.status === "awaiting_approval";
  const yourTurn = task.status === "your_turn";
  const prep = state?.tasks.find((t) => t.parentId === task.id && !t.isMission);
  const tz = state?.settings.tzOffsetMin ?? 0;
  const label = approval ? "Your approval required" : yourTurn ? "AI prepared → you decide" : task.keptHuman ? "Kept by you" : "Only you";

  return (
    <>
      <AnimatePresence>
        {handoff && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-3 flex items-center gap-2 rounded-xl bg-ai-soft px-3 py-2 text-[11px] font-bold tracking-[0.1em] text-ai uppercase"
          >
            <Sparkles size={13} />
            <Morph value={now - (task.handoffAt ?? 0) < 1800 ? "AI preparation complete" : "Your turn"} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-start gap-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-human-soft text-human">
          <Icon size={19} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Chip className={clsx("!h-5 !px-0", approval ? "text-ai" : "text-human")}>{label}</Chip>
            <LeverageBadge score={humanLeverage(task, state?.projects.find((p) => p.id === task.projectId) ?? null).score} />
          </div>
          <h3 className="mt-0.5 text-[16.5px] leading-snug font-semibold tracking-tight text-ink">{task.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <Meta>
              <Clock size={13} /> {fmtDuration(task.humanMinutes || 5)}
            </Meta>
            {task.scheduledAt && <Meta>at {fmtClock(task.scheduledAt, tz)}</Meta>}
            {task.location && (
              <Meta>
                <MapPin size={13} /> {task.location}
              </Meta>
            )}
            {project && (
              <Meta>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} /> {project.name}
              </Meta>
            )}
          </div>
        </div>
      </div>

      {prep && (
        <div className="mt-3.5 flex items-center gap-2.5 rounded-xl bg-card-2 px-3 py-2">
          <AgentAvatar role={prep.agent ?? "research"} size={22} active={prep.status === "ai_running"} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
            {prep.status === "done" ? "AI prep ready — " : prep.status === "ai_running" ? "AI preparing — " : "AI prep queued — "}
            {task.aiPrep.slice(0, 3).join(" · ")}
          </span>
          {prep.status === "done" ? <Check size={14} className="text-ok" /> : null}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {approval && job ? (
          <>
            <Button size="sm" variant="ai" onClick={() => act({ type: "approve_job", jobId: job.id })}>
              <Check size={14} /> Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act({ type: "reject_job", jobId: job.id })}>
              <X size={14} /> Send back
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="human" onClick={() => { void act({ type: "start_task", taskId: task.id }); setFocusId(task.id); }}>
              <Play size={13} fill="currentColor" /> Start
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act({ type: "complete_task", taskId: task.id })}>
              <Check size={14} /> Done
            </Button>
            {task.keptHuman && task.agent && (
              <Button size="sm" variant="ghost" className="ml-auto !text-ai" onClick={() => act({ type: "delegate", taskId: task.id })}>
                <Sparkles size={13} /> Delegate to AI
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );
}

function AiBody({ task, job, project, now }: { task: Task; job: AgentJob | null; project: { name: string; color: string } | null; now: number }) {
  const { act } = useWorkspace();
  const seq = useDelegationSequence(task, job, now);
  const agent = task.agent ? AGENTS[task.agent] : null;
  const running = job?.status === "RUNNING";
  const status = seq ?? (running ? "Running" : job?.status === "QUEUED" ? (job.scheduled_for && job.scheduled_for > now ? "Scheduled" : "Queued") : "Ready to run");
  const pct = Math.floor((job?.progress ?? 0) * 100);
  const eta = running && job?.started_at ? Math.max(0, Math.round((job.est_duration_ms - (now - job.started_at)) / 1000)) : null;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] leading-snug font-semibold tracking-tight text-ink">{task.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.tags.slice(0, 2).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
            {project && <Tag className="!bg-card-2 !text-ink-2">{project.name}</Tag>}
          </div>
        </div>
        <Chip className={clsx("shrink-0", running ? "bg-ai-soft text-ai" : "bg-card-2 text-ink-2")}>
          {running && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ai" />}
          <Morph value={status} />
        </Chip>
      </div>

      {agent && (
        <div className="mt-4 flex items-center gap-2.5">
          <AgentAvatar role={agent.role} size={30} active={running} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-ink">{agent.name}</div>
            <div className={clsx("truncate text-[12px]", running ? "shimmer-text" : "text-ink-3")}>
              {running ? job?.current_step : `Human involvement: ${task.humanMinutes ? `${task.humanMinutes} min` : "none"} · ~${task.aiMinutes} min`}
            </div>
          </div>
          {task.risk !== "low" && (
            <span className="text-[10.5px] font-bold tracking-[0.08em] text-human uppercase">Approval</span>
          )}
        </div>
      )}

      {job ? (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
            <span className="tabular font-semibold text-ink">{pct}%</span>
            <span className="tabular text-ink-3">{eta !== null ? `${eta}s left` : job.executor === "claude" ? "Claude" : "simulated"}</span>
          </div>
          <ProgressLine value={job.progress} active={running} />
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ai" onClick={() => act({ type: "run_task", taskId: task.id })}>
            <Play size={12} fill="currentColor" /> Run now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => act({ type: "assign_me", taskId: task.id })}>
            <User size={13} /> Assign to me
          </Button>
        </div>
      )}
    </>
  );
}

function WaitingBody({ task, project, now }: { task: Task; project: { name: string } | null; now: number }) {
  const { state } = useWorkspace();
  const followUp = state?.tasks.find((t) => t.parentId === task.id && t.title.startsWith("Draft follow-up") && t.status !== "cancelled");
  const days = Math.max(0, Math.floor((now - task.createdAt) / 86_400_000));
  const tz = state?.settings.tzOffsetMin ?? 0;
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card-2 text-ink-2">
          <Hourglass size={17} />
        </span>
        <div className="min-w-0">
          <div className="text-[12px] text-ink-3">
            {task.waitingOn ?? "External"}
            {project && project.name !== task.waitingOn ? ` · ${project.name}` : ""}
          </div>
          <h3 className="mt-0.5 text-[15px] leading-snug font-semibold text-ink">{task.title.replace(/^Waiting for /i, "")}</h3>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-2">
        <CornerDownRight size={13} className="text-ink-3" />
        {followUp ? (
          <span>
            Follow-up {followUp.status === "done" ? "sent" : followUp.status === "awaiting_approval" ? "drafted — needs your OK" : "being drafted"}
          </span>
        ) : task.followUpAt ? (
          <span>
            Follow-up {task.followUpAt - now < 86_400_000 && new Date(task.followUpAt).getUTCDate() !== new Date(now).getUTCDate() ? "tomorrow" : ""} at {fmtClock(task.followUpAt, tz)}
          </span>
        ) : (
          <span>Monitoring</span>
        )}
        <span className="ml-auto tabular text-ink-3">{days === 0 ? "today" : `${days}d`}</span>
      </div>
    </>
  );
}

/** Compact row: completed AI work, with a satisfying moment when it just finished. */
export function DoneRow({ task, now }: { task: Task; now: number }) {
  const { setDrawerId } = useWorkspace();
  const fresh = task.completedAt !== null && now - task.completedAt < 4000;
  return (
    <motion.button
      layout="position"
      layoutId={`card-${task.id}`}
      transition={spring}
      onClick={() => setDrawerId(task.id)}
      initial={fresh ? { opacity: 0.6, scale: 1.02 } : false}
      animate={{ opacity: 1, scale: 1 }}
      className={clsx(
        "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-[1500ms]",
        fresh ? "bg-ok/12" : "hover:bg-card-2",
      )}
    >
      <span className="text-ok">{fresh ? <CheckDraw size={18} /> : <Check size={16} />}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{task.title}</span>
      {task.agent && <span className="text-[11px] text-ink-3">{AGENTS[task.agent].short}</span>}
      <ArrowRight size={13} className="text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </motion.button>
  );
}
