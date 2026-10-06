"use client";

import clsx from "clsx";
import { Battery, BatteryLow, BatteryMedium, CalendarCheck, Car, Laptop, MapPin, Send, Sparkles, User, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { AGENTS } from "@/lib/agents";
import { activeDecisions, simulateDay, timeArbitrage, type AiBlock, type HumanBlock } from "@/lib/optimizer";
import { fmtClock, fmtDuration } from "@/lib/planner";
import type { Energy, Place, StrategyId } from "@/lib/types";
import { useWorkspace } from "../store";
import { AgentAvatar, Button, Empty, Eyebrow, LeverageBadge, SectionTitle, Toggle } from "../ui";

// ---------------------------------------------------------------------------
// Context: energy, place, maximum leverage

const ENERGY: { id: Energy; label: string; icon: typeof Battery }[] = [
  { id: "high", label: "High energy", icon: Battery },
  { id: "medium", label: "Medium", icon: BatteryMedium },
  { id: "low", label: "Low energy", icon: BatteryLow },
];
const PLACES: { id: Place; label: string; icon: typeof Laptop }[] = [
  { id: "desk", label: "At my desk", icon: Laptop },
  { id: "on_the_go", label: "On the go", icon: Car },
  { id: "out", label: "Out", icon: MapPin },
];

export function ContextBar({ compact = false }: { compact?: boolean }) {
  const { state, act } = useWorkspace();
  if (!state) return null;
  const pill = (active: boolean) =>
    clsx("relative inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors", active ? "text-ink" : "text-ink-3 hover:text-ink");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-full bg-card p-1 ring-1 ring-line" role="radiogroup" aria-label="Energy">
        {ENERGY.map((e) => {
          const Icon = e.icon;
          const on = state.settings.energy === e.id;
          return (
            <button key={e.id} role="radio" aria-checked={on} onClick={() => act({ type: "set_context", energy: e.id })} className={pill(on)} title={e.label}>
              {on && <motion.span layoutId={`energy-${compact}`} className="absolute inset-0 rounded-full bg-card-2" />}
              <Icon size={14} className="relative" />
              {!compact && <span className="relative">{e.label}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex rounded-full bg-card p-1 ring-1 ring-line" role="radiogroup" aria-label="Where are you">
        {PLACES.map((p) => {
          const Icon = p.icon;
          const on = state.settings.place === p.id;
          return (
            <button key={p.id} role="radio" aria-checked={on} onClick={() => act({ type: "set_context", place: p.id })} className={pill(on)} title={p.label}>
              {on && <motion.span layoutId={`place-${compact}`} className="absolute inset-0 rounded-full bg-card-2" />}
              <Icon size={14} className="relative" />
              {!compact && <span className="relative">{p.label}</span>}
            </button>
          );
        })}
      </div>
      <label
        className={clsx(
          "inline-flex h-11 items-center gap-2.5 rounded-full py-1 pr-1.5 pl-4 ring-1 transition-colors",
          state.settings.maxLeverage ? "bg-human-soft ring-human/40" : "bg-card ring-line",
        )}
        title="Delegate, prepare and follow up everything the AI can. Only work that genuinely needs you stays on your list."
      >
        <Zap size={14} className={state.settings.maxLeverage ? "text-human" : "text-ink-3"} />
        <span className="text-[11px] font-bold tracking-[0.12em] uppercase">Maximum leverage</span>
        <Toggle on={state.settings.maxLeverage} onChange={(on) => act({ type: "set_max_leverage", on })} label="Maximum leverage" />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strategic memory

export function TellBox() {
  const { act } = useWorkspace();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    await act({ type: "tell", text: t });
    setBusy(false);
    setText("");
  };
  return (
    <div className="card rounded-[24px] p-5">
      <Eyebrow>Tell your Chief of Staff</Eyebrow>
      <form
        className="mt-3 flex items-center gap-2 rounded-full bg-card-2 py-1.5 pr-1.5 pl-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="I’m focusing on Patrick Pons this week"
          maxLength={500}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3"
        />
        <Button size="sm" variant="primary" disabled={busy || !text.trim()} type="submit">
          <Send size={13} /> Tell
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["I’m focusing on Patrick Pons this week", "Pause Kopi for 2 weeks", "No meetings before 10am"].map((ex) => (
          <button key={ex} onClick={() => setText(ex)} className="rounded-full bg-card-2 px-2.5 py-1 text-[11.5px] text-ink-2 hover:text-ink">
            {ex}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-ink-3">Focus and pause decisions change recommendations right away; anything else is kept as a note.</p>
    </div>
  );
}

export function DecisionLog({ now }: { now: number }) {
  const { state } = useWorkspace();
  if (!state) return null;
  const active = new Set(activeDecisions(state, now).map((d) => d.id));
  return (
    <div className="card rounded-[24px] p-5">
      <Eyebrow>Decisions</Eyebrow>
      <ul className="mt-3 flex max-h-[320px] flex-col gap-3 overflow-y-auto">
        {state.decisions.slice(0, 20).map((d) => (
          <li key={d.id} className={clsx("border-l-2 pl-3", active.has(d.id) ? "border-ai" : "border-line-2 opacity-60")}>
            <div className="text-[11px] text-ink-3">
              {new Date(d.at - state.settings.tzOffsetMin * 60_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} · {d.kind === "park" ? "pause" : d.kind}
              {d.until && active.has(d.id) ? ` · until ${new Date(d.until - state.settings.tzOffsetMin * 60_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}
            </div>
            <div className="text-[13.5px] font-semibold">{d.title}</div>
            <div className="text-[12px] text-ink-2">{d.reason}</div>
            {d.expected && <div className="text-[12px] text-ink-3">Expected: {d.expected}</div>}
          </li>
        ))}
        {state.decisions.length === 0 && <Empty title="No decisions yet" body="Focus a project or answer a trade-off — I’ll remember it." />}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TIME ARBITRAGE

function Schedule({ human, ai, tz }: { human: HumanBlock[]; ai: AiBlock[]; tz: number }) {
  const { setDrawerId } = useWorkspace();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <Eyebrow className="!text-human">
          <User size={11} className="mr-1 inline" /> You
        </Eyebrow>
        <ol className="mt-2 flex flex-col gap-2">
          {human.map((h) => (
            <li key={h.task.id}>
              <button onClick={() => setDrawerId(h.task.id)} className="flex w-full items-start gap-3 rounded-2xl bg-human-soft px-3.5 py-3 text-left">
                <span className="tabular w-[92px] shrink-0 text-[12px] text-ink-2">
                  {fmtClock(h.start, tz)}–{fmtClock(h.end, tz)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">{h.task.title}</span>
                  <span className="block text-[11.5px] text-ink-3">{fmtDuration(h.minutes)} · {h.why}</span>
                </span>
                <LeverageBadge score={h.leverage} />
              </button>
            </li>
          ))}
          {human.length === 0 && <Empty title="Nothing fits" body="No human work fits this window — the AI keeps going." />}
        </ol>
      </div>
      <div>
        <Eyebrow className="!text-ai">
          <Sparkles size={11} className="mr-1 inline" /> AI working in parallel
        </Eyebrow>
        <ol className="mt-2 flex flex-col gap-2">
          {ai.slice(0, 10).map((a, i) => (
            <li key={(a.task?.id ?? a.draft?.title ?? "") + i}>
              <button
                onClick={() => a.task && setDrawerId(a.task.id)}
                className="flex w-full items-start gap-3 rounded-2xl bg-ai-soft px-3.5 py-3 text-left"
              >
                <span className="tabular w-[46px] shrink-0 text-[12px] text-ink-2">{fmtClock(a.start, tz)}</span>
                <AgentAvatar role={a.agent} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{a.task?.title ?? a.draft?.title}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">
                    {AGENTS[a.agent].short} · {a.minutes} min · {a.why}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {ai.length === 0 && <Empty title="AI is caught up" body="No autonomous work to run in this window." />}
        </ol>
      </div>
    </div>
  );
}

export function ArbitragePanel({ now }: { now: number }) {
  const { state, arbitrageMinutes, setArbitrageMinutes } = useWorkspace();
  const plan = useMemo(() => (state ? timeArbitrage(state, arbitrageMinutes, now) : null), [state, arbitrageMinutes, now]);
  if (!state || !plan) return null;
  return (
    <section>
      <SectionTitle dot="var(--human)">Time arbitrage</SectionTitle>
      <div className="card rounded-[26px] p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[18px] font-semibold tracking-tight">I have</span>
          {[30, 60, 90, 120, 180].map((m) => (
            <button
              key={m}
              onClick={() => setArbitrageMinutes(m)}
              className={clsx("h-9 rounded-full px-3.5 text-[13px] font-semibold", arbitrageMinutes === m ? "bg-ink text-app" : "bg-card-2 text-ink-2 hover:text-ink")}
            >
              {fmtDuration(m)}
            </button>
          ))}
          <label className="inline-flex h-9 items-center gap-2 rounded-full bg-card-2 px-3 text-[13px] text-ink-2">
            <input
              type="number"
              min={10}
              max={600}
              step={5}
              value={arbitrageMinutes}
              onChange={(e) => setArbitrageMinutes(Math.max(10, Math.min(600, Number(e.target.value) || 10)))}
              className="tabular w-14 bg-transparent text-ink outline-none"
              aria-label="Minutes available"
            />
            min
          </label>
        </div>
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold">Your {fmtDuration(arbitrageMinutes)} optimal plan</h3>
          <span className="text-[12.5px] text-ink-3">
            {fmtDuration(plan.usedMinutes)} of you · {fmtDuration(plan.ai.reduce((s, a) => s + a.minutes, 0))} of AI work in parallel
          </span>
        </div>
        <div className="mt-4">
          <Schedule human={plan.human} ai={plan.ai} tz={state.settings.tzOffsetMin} />
        </div>
        {plan.delegateInstead.length > 0 && (
          <div className="mt-4 rounded-2xl bg-card-2 px-4 py-3 text-[13px]">
            {plan.delegateInstead.map((d) => (
              <div key={d.task.id}>
                <b className="font-semibold">Delegate “{d.task.title}”</b> <span className="text-ink-2">and spend those {fmtDuration(d.saved)} on {d.instead ? `“${d.instead.title}”` : "higher-leverage work"}.</span>
              </div>
            ))}
          </div>
        )}
        {plan.skipped.length > 0 && (
          <details className="mt-3 text-[12.5px] text-ink-3">
            <summary className="cursor-pointer">Left out ({plan.skipped.length})</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {plan.skipped.map((s) => (
                <li key={s.task.id}>
                  {s.task.title} — {s.why}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SIMULATE MY DAY + DAY BUILDER

export function DaySimulator({ now }: { now: number }) {
  const { state, act } = useWorkspace();
  const [hours, setHours] = useState(5);
  const [selected, setSelected] = useState<StrategyId | null>(null);
  const [busy, setBusy] = useState(false);
  const sim = useMemo(() => (state ? simulateDay(state, hours * 60, now) : null), [state, hours, now]);
  if (!state || !sim) return null;
  const choice = selected ?? sim.recommended;
  const plan = state.settings.dayPlan;

  return (
    <section>
      <SectionTitle dot="var(--ai)">Simulate my day</SectionTitle>
      <div className="card rounded-[26px] p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[18px] font-semibold tracking-tight">I have</span>
          <label className="inline-flex h-10 items-center gap-2 rounded-full bg-card-2 px-4 text-[14px]">
            <input
              type="number"
              min={1}
              max={12}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              className="tabular w-10 bg-transparent font-semibold outline-none"
              aria-label="Hours available"
            />
            hours
          </label>
          <span className="text-[13px] text-ink-3">— four ways to spend them</span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
          {sim.strategies.map((s) => {
            const on = s.id === choice;
            return (
              <motion.button
                key={s.id}
                layout
                whileHover={{ y: -2 }}
                onClick={() => setSelected(s.id)}
                className={clsx("relative rounded-[22px] p-4 text-left ring-1 transition-colors", on ? "bg-ai-soft ring-ai/50" : "bg-card-2 ring-line")}
              >
                {s.id === sim.recommended && (
                  <span className="absolute top-3 right-3 rounded-full bg-ai px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-white uppercase">Recommended</span>
                )}
                <div className="text-[18px] font-semibold tracking-tight">{s.label}</div>
                <div className="text-[12px] text-ink-3">{s.goal}</div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <dt className="text-ink-3">Your time</dt>
                    <dd className="tabular font-semibold">{fmtDuration(s.humanMinutes)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">AI time</dt>
                    <dd className="tabular font-semibold">{fmtDuration(s.aiMinutes)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Impact</dt>
                    <dd className={clsx("font-semibold", s.impact === "HIGH" ? "text-ok" : s.impact === "MEDIUM" ? "text-ai" : "text-ink-2")}>{s.impact}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Progress</dt>
                    <dd className="font-semibold">{s.projects.length ? `+${Math.round(s.projects.reduce((a, p) => a + p.delta, 0) * 100)}%` : "—"}</dd>
                  </div>
                </dl>
                <div className="mt-3 truncate text-[11.5px] text-ink-3">{s.projects.map((p) => p.project.name).join(" · ") || "No project moves"}</div>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card-2 px-4 py-3">
          <p className="text-[13px]">
            <b className="font-semibold">Recommended: {sim.strategies.find((s) => s.id === sim.recommended)?.label}.</b> <span className="text-ink-2">{sim.reason}</span>
          </p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await act({ type: "build_day", strategy: choice, minutes: hours * 60 });
              setBusy(false);
            }}
          >
            <CalendarCheck size={15} /> Build my day — {sim.strategies.find((s) => s.id === choice)?.label}
          </Button>
        </div>

        <AnimatePresence>
          {plan && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 border-t border-line pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold">
                  Your day — {plan.strategy} · built {fmtClock(plan.createdAt, state.settings.tzOffsetMin)}
                </h3>
                <button onClick={() => act({ type: "clear_day_plan" })} className="text-[12px] text-ink-3 hover:text-ink">
                  Clear
                </button>
              </div>
              <DayPlanView />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function DayPlanView() {
  const { state, setDrawerId } = useWorkspace();
  if (!state?.settings.dayPlan) return null;
  const tz = state.settings.tzOffsetMin;
  const blocks = state.settings.dayPlan.blocks;
  const lane = (l: "you" | "ai") => blocks.filter((b) => b.lane === l).sort((a, b) => a.start - b.start);
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {(["you", "ai"] as const).map((l) => (
        <div key={l}>
          <Eyebrow className={l === "you" ? "!text-human" : "!text-ai"}>{l === "you" ? "Human schedule" : "AI schedule"}</Eyebrow>
          <ol className="mt-2 flex flex-col gap-1.5">
            {lane(l).map((b, i) => (
              <li key={b.taskId + i}>
                <button onClick={() => b.taskId && setDrawerId(b.taskId)} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-card-2">
                  <span className="tabular w-[92px] shrink-0 text-[12px] text-ink-3">
                    {fmtClock(b.start, tz)}
                    {l === "you" ? `–${fmtClock(b.end, tz)}` : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{b.title}</span>
                  {b.agent && <span className="text-[11px] text-ink-3">{AGENTS[b.agent].short}</span>}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

