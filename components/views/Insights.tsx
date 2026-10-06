"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { AGENT_ORDER, AGENTS } from "@/lib/agents";
import { fmtDuration, startOfToday, startOfWeek, timeSaved } from "@/lib/planner";
import { useNow, useWorkspace } from "../store";
import { AutomationReport, EfficiencyCard, LeverageCard, SavedTriplet, WeeklyReport } from "../intel/Reports";
import { AGENT_ICON, AnimatedNumber, enter, SectionTitle } from "../ui";

const DAY = 86_400_000;

/** INSIGHTS — the value of delegating, made visible. */
export function Insights() {
  const now = useNow(5000);
  const { state } = useWorkspace();
  if (!state) return null;
  const tz = state.settings.tzOffsetMin;
  const week = timeSaved(state.jobs, startOfWeek(now, tz));
  const today0 = startOfToday(now, tz);

  // Last 7 days of saved minutes (single series → one hue).
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = today0 - (6 - i) * DAY;
    const end = start + DAY;
    const minutes = state.jobs
      .filter((j) => j.status === "COMPLETED" && (j.completed_at ?? 0) >= start && (j.completed_at ?? 0) < end)
      .reduce((s, j) => s + j.saved_minutes, 0);
    const label = new Date(start - tz * 60_000).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    return { start, minutes, label, today: i === 6 };
  });

  const byAgent = AGENT_ORDER.map((role) => {
    const jobs = state.jobs.filter((j) => j.agent === role && j.status === "COMPLETED" && (j.completed_at ?? 0) >= startOfWeek(now, tz));
    return { role, count: jobs.length, minutes: jobs.reduce((s, j) => s + j.saved_minutes, 0) };
  }).sort((a, b) => b.minutes - a.minutes);

  const doneWeek = state.tasks.filter((t) => t.status === "done" && (t.completedAt ?? 0) >= startOfWeek(now, tz) && !t.isMission);
  const doneByAi = doneWeek.filter((t) => state.jobs.some((j) => j.task_id === t.id && j.status === "COMPLETED") && t.mode !== "YOU").length;
  const share = doneWeek.length ? doneByAi / doneWeek.length : 0;

  return (
    <motion.div initial="hidden" animate="show" className="flex flex-col gap-8 pt-6 lg:pt-8">
      <motion.section variants={enter} custom={0} className="relative overflow-hidden rounded-[32px] bg-hero p-8 text-hero-ink sm:p-12">
        <div className="ambient-light" aria-hidden />
        <div className="relative">
          <div className="mb-4 text-[11px] font-bold tracking-[0.18em] text-hero-ink-2 uppercase">AI saved you</div>
          <SavedTriplet now={now} />
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.9, duration: 0.6 }} className="mt-4 text-[18px] text-hero-ink-2">
            You got <span className="font-semibold text-hero-ink">{fmtDuration(week.minutes)}</span> of your life back. {week.count} tasks completed by your AI workforce.
          </motion.p>
        </div>
      </motion.section>

      <motion.div variants={enter} custom={1} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LeverageCard now={now} />
        <EfficiencyCard now={now} />
      </motion.div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <motion.section variants={enter} custom={1} className="xl:col-span-7">
          <SectionTitle>Time saved per day</SectionTitle>
          <DayColumns days={days} />
        </motion.section>
        <motion.section variants={enter} custom={2} className="xl:col-span-5">
          <SectionTitle>By agent · this week</SectionTitle>
          <div className="card rounded-[26px] p-5">
            <ul className="flex flex-col gap-3.5">
              {byAgent.map(({ role, count, minutes }) => {
                const max = Math.max(1, ...byAgent.map((b) => b.minutes));
                const Icon = AGENT_ICON[role];
                return (
                  <li key={role} className="grid grid-cols-[110px_1fr_64px] items-center gap-3" title={`${AGENTS[role].name}: ${fmtDuration(minutes)} saved over ${count} tasks`}>
                    <span className="flex items-center gap-2 text-[13px] text-ink-2">
                      <Icon size={14} /> {AGENTS[role].short}
                    </span>
                    <span className="relative h-4">
                      <motion.span
                        className="absolute inset-y-0 left-0 rounded-r-[4px] bg-ai"
                        initial={{ width: 0 }}
                        animate={{ width: `${(minutes / max) * 100}%` }}
                        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </span>
                    <span className="tabular text-right text-[12.5px] text-ink">{minutes ? fmtDuration(minutes) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </motion.section>
      </div>

      <motion.section variants={enter} custom={3} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card rounded-[24px] p-6">
          <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">Delegation rate</div>
          <AnimatedNumber value={Math.round(share * 100)} format={(n) => `${Math.round(n)}%`} className="mt-2 block text-[40px] font-semibold tracking-tight" />
          <div className="text-[12.5px] text-ink-3">of this week’s finished work was done by AI ({doneByAi}/{doneWeek.length})</div>
        </div>
        <div className="card rounded-[24px] p-6">
          <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">Always delegate</div>
          {state.settings.delegationRules.length ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {state.settings.delegationRules.map((r) => (
                <li key={r} className="rounded-full bg-ai-soft px-2.5 py-1 text-[12px] text-ai">“{r}”</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">No rules yet. When you do something by hand that I could have done, I’ll offer to take it next time.</p>
          )}
        </div>
        <div className="card rounded-[24px] p-6">
          <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">How this is measured</div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            Saved time = estimated manual time minus your own involvement, for each AI job you accepted. Estimates come from {state.claudeEnabled ? "Claude" : "the local classifier"} — treat them as directional, not exact.
          </p>
        </div>
      </motion.section>
      <motion.div variants={enter} custom={4} className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <AutomationReport now={now} />
        </div>
        <div className="xl:col-span-7">
          <WeeklyReport now={now} />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Column chart: ≤24px columns, 4px rounded cap, square base, value on hover + on the max. */
function DayColumns({ days }: { days: { start: number; minutes: number; label: string; today: boolean }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(60, ...days.map((d) => d.minutes));
  const top = Math.ceil(max / 60) * 60;
  const H = 220;
  const peak = days.reduce((m, d, i) => (d.minutes > days[m].minutes ? i : m), 0);
  return (
    <div className="card rounded-[26px] p-5">
      <div className="relative" style={{ height: H + 28 }}>
        {[0, 0.5, 1].map((f) => (
          <div key={f} className="absolute right-0 left-10 border-t border-line" style={{ top: H - f * H }}>
            <span className="tabular absolute -top-2 -left-10 w-8 text-right text-[10.5px] text-ink-3">{fmtDuration(top * f)}</span>
          </div>
        ))}
        <div className="absolute top-0 right-0 bottom-7 left-10 flex">
          {days.map((d, i) => {
            const h = (d.minutes / top) * H;
            const show = hover === i || (hover === null && i === peak && d.minutes > 0);
            return (
              <div
                key={d.start}
                className="relative flex flex-1 items-end justify-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${d.label}: ${fmtDuration(d.minutes)} saved`}
              >
                {show && (
                  <span className="tabular absolute z-10 rounded-lg bg-ink px-2 py-1 text-[11.5px] font-semibold whitespace-nowrap text-app" style={{ bottom: h + 8 }}>
                    {fmtDuration(d.minutes)}
                  </span>
                )}
                <motion.span
                  className="block w-full max-w-[24px] rounded-t-[4px]"
                  style={{ background: "var(--ai)", opacity: hover === null || hover === i ? 1 : 0.45 }}
                  initial={{ height: 0 }}
                  animate={{ height: Math.max(d.minutes ? 3 : 0, h) }}
                  transition={{ duration: 0.8, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            );
          })}
        </div>
        <div className="absolute right-0 bottom-0 left-10 flex">
          {days.map((d) => (
            <span key={d.start} className={`flex-1 text-center text-[11px] ${d.today ? "font-semibold text-ink" : "text-ink-3"}`}>
              {d.today ? "Today" : d.label}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Time saved by AI per day</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.start}>
              <th>{d.label}</th>
              <td>{d.minutes} minutes</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
