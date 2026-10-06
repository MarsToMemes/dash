"use client";

import clsx from "clsx";
import { Archive, ArrowRight, Flame, Layers, Play, Scale, Scissors, Sparkles, Target, Trash2, Unlock, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  deadProjects,
  finishWhatMatters,
  portfolioTriage,
  procrastination,
  strategicTradeOff,
  unblockActions,
} from "@/lib/optimizer";
import { fmtDuration, workforce } from "@/lib/planner";
import { OpportunityCard } from "../home/Sections";
import { useWorkspace } from "../store";
import { AGENT_ICON, Button, Empty, SectionTitle } from "../ui";

function Card({ icon: Icon, eyebrow, tone = "ai", children }: { icon: typeof Zap; eyebrow: string; tone?: "ai" | "human" | "bad"; children: React.ReactNode }) {
  const toneCls = tone === "human" ? "text-human" : tone === "bad" ? "text-bad" : "text-ai";
  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className="card rounded-[24px] p-5">
      <div className={clsx("flex items-center gap-2 text-[10.5px] font-bold tracking-[0.14em] uppercase", toneCls)}>
        <Icon size={13} /> {eyebrow}
      </div>
      {children}
    </motion.div>
  );
}

/**
 * The Chief of Staff's recommendations, most valuable first:
 * unblock you → finish what matters → stop avoiding → prune → decide → delegate → opportunities.
 */
export function Recommendations({ now, limit }: { now: number; limit?: number }) {
  const { state, act, setView } = useWorkspace();
  if (!state) return null;
  const cards: { key: string; node: React.ReactNode }[] = [];
  const focus = state.settings.focus && state.settings.focus.until > now ? state.settings.focus : null;

  for (const u of unblockActions(state, now).filter((x) => x.kind !== "follow_up").slice(0, 2)) {
    cards.push({
      key: `unblock-${u.human.id}-${u.kind}`,
      node: (
        <Card icon={Unlock} eyebrow="Unblock you">
          <p className="mt-2 text-[15px] font-semibold tracking-tight">{u.message}</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Then: “{u.human.title}” — ready for you, with everything you need.</p>
          <Button
            size="sm"
            variant="ai"
            className="mt-4"
            onClick={() => (u.kind === "run" && u.blocker ? act({ type: "run_task", taskId: u.blocker.id }) : act({ type: "delegate", taskId: u.human.id }))}
          >
            <Play size={12} fill="currentColor" /> {u.kind === "run" ? "Run it now" : "Prepare it"}
          </Button>
        </Card>
      ),
    });
  }

  const finish = finishWhatMatters(state, now)[0];
  if (finish && focus?.projectId !== finish.project.id) {
    cards.push({
      key: `finish-${finish.project.id}`,
      node: (
        <Card icon={Target} eyebrow="Finish what matters" tone="human">
          <p className="mt-2 text-[15px] font-semibold tracking-tight">{finish.message}</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Recommendation: finish {finish.project.name} before starting another major project. The AI has ~{fmtDuration(finish.aiMinutes)} of work it can run in parallel.
          </p>
          <Button size="sm" variant="human" className="mt-4" onClick={() => act({ type: "focus_project", projectId: finish.project.id, days: 2 })}>
            <Target size={13} /> Focus this project
          </Button>
        </Card>
      ),
    });
  }

  const pro = procrastination(state, now)[0];
  if (pro) {
    cards.push({
      key: `pro-${pro.task.id}`,
      node: (
        <Card icon={Flame} eyebrow={`Postponed ${pro.count} times`} tone="bad">
          <p className="mt-2 text-[15px] font-semibold tracking-tight">Why are we avoiding “{pro.task.title}”?</p>
          <p className="mt-1 text-[12.5px] text-ink-2">{pro.diagnosis}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => act({ type: "procrastination_answer", taskId: pro.task.id, choice: "break_down" })}>
              <Scissors size={13} /> Break it down
            </Button>
            {pro.suggestions.includes("delegate") && (
              <Button size="sm" variant="ai" onClick={() => act({ type: "procrastination_answer", taskId: pro.task.id, choice: "delegate" })}>
                <Sparkles size={13} /> Delegate
              </Button>
            )}
            {pro.suggestions.includes("delete") && (
              <Button size="sm" variant="ghost" onClick={() => act({ type: "procrastination_answer", taskId: pro.task.id, choice: "delete" })}>
                <Trash2 size={13} /> Delete
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => act({ type: "procrastination_answer", taskId: pro.task.id, choice: "keep" })}>
              Keep it
            </Button>
          </div>
        </Card>
      ),
    });
  }

  const dead = deadProjects(state, now)[0];
  if (dead) {
    cards.push({
      key: `dead-${dead.project.id}`,
      node: (
        <Card icon={Archive} eyebrow="Project losing momentum" tone="bad">
          <p className="mt-2 text-[15px] font-semibold tracking-tight">{dead.project.name}</p>
          <ul className="mt-2 flex flex-col gap-0.5 text-[12.5px] text-ink-2">
            {dead.signals.slice(0, 4).map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-ink-3">Don’t carry it mentally forever. Recommendation: {dead.recommendation === "park" ? "park it for 7 days" : "revive it with a clear next step"}.</p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant={dead.recommendation === "park" ? "primary" : "soft"} onClick={() => act({ type: "park_project", projectId: dead.project.id, days: 7, reason: dead.signals.join(" · ") })}>
              <Archive size={13} /> Park for 7 days
            </Button>
            <Button size="sm" variant={dead.recommendation === "revive" ? "primary" : "soft"} onClick={() => act({ type: "revive_project", projectId: dead.project.id })}>
              Revive
            </Button>
          </div>
        </Card>
      ),
    });
  }

  const trade = strategicTradeOff(state, now);
  if (trade && !focus) {
    cards.push({
      key: `trade-${trade.a.id}-${trade.b.id}`,
      node: (
        <Card icon={Scale} eyebrow="Decision">
          <p className="mt-2 text-[15px] font-semibold tracking-tight">
            {trade.a.name} vs {trade.b.name}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[trade.a, trade.b].map((p) => (
              <div key={p.id} className={clsx("rounded-2xl px-3 py-2.5 ring-1", p.id === trade.winner.id ? "bg-ai-soft ring-ai/30" : "bg-card-2 ring-line")}>
                <div className="text-[13px] font-semibold">{p.name}</div>
                <ul className="mt-1 flex flex-col gap-0.5 text-[11.5px] text-ink-2">
                  {trade.points[p.id].map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px]">
            <span className="font-semibold">Recommendation: {trade.winner.name} for the next {trade.days} days.</span>{" "}
            <span className="text-ink-2">{trade.reason}</span>
          </p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="ai" onClick={() => act({ type: "tradeoff_answer", winnerId: trade.winner.id, loserId: trade.loser.id, accepted: true, days: trade.days })}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act({ type: "tradeoff_answer", winnerId: trade.winner.id, loserId: trade.loser.id, accepted: false, days: trade.days })}>
              Override — {trade.loser.name}
            </Button>
          </div>
        </Card>
      ),
    });
  }

  const triage = portfolioTriage(state, now);
  if (triage.overloaded && triage.park.length) {
    cards.push({
      key: "triage",
      node: (
        <Card icon={Layers} eyebrow="Too many active projects">
          <p className="mt-2 text-[15px] font-semibold tracking-tight">
            You have {triage.primary.length + triage.secondary.length + triage.park.length} active projects. Here’s how I’d split your attention.
          </p>
          <div className="mt-3 flex flex-col gap-2 text-[12.5px]">
            {(
              [
                ["Primary", triage.primary, "text-ok"],
                ["Secondary", triage.secondary, "text-ai"],
                ["Park", triage.park, "text-ink-3"],
              ] as const
            ).map(([label, rows, tone]) =>
              rows.length ? (
                <div key={label} className="grid grid-cols-[80px_1fr] gap-2">
                  <span className={clsx("text-[10.5px] font-bold tracking-[0.12em] uppercase", tone)}>{label}</span>
                  <span className="flex flex-col gap-0.5">
                    {rows.map((r) => (
                      <span key={r.project.id}>
                        <b className="font-semibold">{r.project.name}</b> <span className="text-ink-2">— {r.reason}</span>
                      </span>
                    ))}
                  </span>
                </div>
              ) : null,
            )}
          </div>
          <Button size="sm" variant="primary" className="mt-4" onClick={() => act({ type: "apply_triage" })}>
            Apply — park {triage.park.length} for 7 days
          </Button>
        </Card>
      ),
    });
  }

  const backlog = workforce(state, now).suggested;
  if (backlog.length) {
    cards.push({
      key: "backlog",
      node: (
        <Card icon={Zap} eyebrow="AI backlog">
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold tracking-tight">I found {backlog.length} task{backlog.length > 1 ? "s" : ""} I can handle for you.</p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">Could save ~{fmtDuration(backlog.reduce((s, t) => s + t.manualMinutes, 0))} of your time</p>
            </div>
            <Button size="sm" variant="ai" onClick={() => act({ type: "run_all", taskIds: backlog.map((t) => t.id) })}>
              <Play size={12} fill="currentColor" /> Run all
            </Button>
          </div>
          <ol className="mt-3 flex flex-col">
            {backlog.slice(0, 4).map((t) => {
              const Icon = t.agent ? AGENT_ICON[t.agent] : Sparkles;
              return (
                <li key={t.id} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                  <Icon size={14} className="shrink-0 text-ai" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                  <button onClick={() => act({ type: "run_task", taskId: t.id })} className="rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] text-ai uppercase hover:bg-ai-soft">
                    Run
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>
      ),
    });
  }

  for (const o of state.opportunities.filter((x) => x.status === "open")) cards.push({ key: `opp-${o.id}`, node: <OpportunityCard o={o} /> });

  const shown = limit ? cards.slice(0, limit) : cards;
  return (
    <section>
      <SectionTitle dot="var(--ai)" right={limit && cards.length > limit ? (
        <button onClick={() => setView("strategy")} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ai hover:underline">
          All {cards.length} <ArrowRight size={13} />
        </button>
      ) : undefined}>
        AI found this
      </SectionTitle>
      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((c) => (
            <motion.div key={c.key} layout>
              {c.node}
            </motion.div>
          ))}
        </AnimatePresence>
        {cards.length === 0 && <Empty title="Nothing to fix" body="Your projects are moving and nothing is stuck." />}
      </div>
    </section>
  );
}

