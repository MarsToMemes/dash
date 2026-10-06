"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Wand2 } from "lucide-react";
import { motion } from "motion/react";
import { AGENTS } from "@/lib/agents";
import { automationReport, dailyReview, humanLeverageKpi, savedSummary, weeklyReview, workflowEfficiency } from "@/lib/optimizer";
import { fmtDuration } from "@/lib/planner";
import { useWorkspace } from "../store";
import { AnimatedNumber, Button, Empty, Eyebrow, SectionTitle } from "../ui";

export function EfficiencyCard({ now }: { now: number }) {
  const { state } = useWorkspace();
  if (!state) return null;
  const e = workflowEfficiency(state, now);
  const delta = e.previous !== null ? e.score - e.previous : 0;
  return (
    <div className="card rounded-[24px] p-6">
      <Eyebrow>Workflow efficiency</Eyebrow>
      <div className="mt-2 flex items-baseline gap-3">
        <AnimatedNumber value={e.score} className="text-[44px] leading-none font-semibold tracking-tight" />
        <span className="text-ink-3">/ 100</span>
        {e.previous !== null && delta !== 0 && (
          <span className={clsx("inline-flex items-center gap-0.5 text-[13px] font-semibold", delta > 0 ? "text-ok" : "text-bad")}>
            {delta > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />} {e.previous} → {e.score}
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] text-ink-2">{e.reason}</p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {e.parts.map((p) => (
          <li key={p.label} className="grid grid-cols-[130px_1fr_48px] items-center gap-3 text-[12.5px]">
            <span className="text-ink-2">{p.label}</span>
            <span className="relative h-2 rounded-full bg-card-2">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full bg-ai"
                initial={{ width: 0 }}
                animate={{ width: `${(p.value / p.max) * 100}%` }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
            <span className="tabular text-right text-ink-3">
              {Math.round(p.value)}/{p.max}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeverageCard({ now }: { now: number }) {
  const { state, setDrawerId } = useWorkspace();
  if (!state) return null;
  const week = humanLeverageKpi(state, now - 7 * 86_400_000);
  return (
    <div className="card rounded-[24px] p-6">
      <Eyebrow>Human leverage · last 7 days</Eyebrow>
      <div className="mt-2 text-[44px] leading-none font-semibold tracking-tight">
        {week.pct === null ? "—" : <AnimatedNumber value={week.pct} format={(n) => `${Math.round(n)}%`} />}
      </div>
      <p className="mt-2 text-[13px] text-ink-2">
        {week.pct === null
          ? "No human work logged yet. Use Start → Done so I can measure it."
          : `${fmtDuration(week.highMinutes)} of your ${fmtDuration(week.minutes)} went to work that needed you.`}
      </p>
      {week.wasted.length > 0 && (
        <div className="mt-4 rounded-2xl bg-bad/8 px-4 py-3">
          <div className="text-[12.5px] font-semibold text-bad">Wasted: {fmtDuration(week.wastedMinutes)} on delegable work</div>
          <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-ink-2">
            {week.wasted.map((t) => (
              <li key={t.id}>
                <button onClick={() => setDrawerId(t.id)} className="text-left hover:underline">
                  {t.title} — {fmtDuration(t.actualHumanMinutes ?? t.humanMinutes)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-ink-3">The goal isn’t more tasks — it’s more of your time on high-value human work.</p>
    </div>
  );
}

/** AUTOMATION REPORT — recurring work still done by hand. */
export function AutomationReport({ now }: { now: number }) {
  const { state, act } = useWorkspace();
  if (!state) return null;
  const r = automationReport(state, now);
  return (
    <section>
      <SectionTitle dot="var(--ai)">Automation report</SectionTitle>
      <div className="card rounded-[24px] p-6">
        {r.items.length === 0 ? (
          <Empty title="Nothing to automate" body="You’re not doing anything by hand that an agent could own." />
        ) : (
          <>
            <p className="text-[16px] font-semibold tracking-tight">
              I found {r.items.length} recurring task{r.items.length > 1 ? "s" : ""} you could delegate.
            </p>
            <p className="mt-0.5 text-[13px] text-ink-2">Potential time saved: ~{fmtDuration(r.minutesPerWeek)} / week</p>
            <ol className="mt-4 flex flex-col">
              {r.items.map((i, n) => (
                <li key={i.phrase} className="flex items-center gap-3 border-t border-line py-2.5 text-[13px] first:border-t-0">
                  <span className="tabular w-4 text-ink-3">{n + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.label}</span>
                    <span className="block text-[11.5px] text-ink-3">
                      {[i.count ? `${i.count}× by hand` : null, i.pending ? "still on your list" : null].filter(Boolean).join(" · ")} · {AGENTS[i.agent].name} · rule “{i.phrase}”
                    </span>
                  </span>
                  <span className="tabular text-ok">~{fmtDuration(i.minutesPerWeek)}/wk</span>
                </li>
              ))}
            </ol>
            <Button variant="ai" className="mt-4" onClick={() => act({ type: "automate", phrases: r.items.map((i) => i.phrase) })}>
              <Wand2 size={14} /> Automate these
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/** END-OF-DAY OPTIMIZATION */
export function DailyReviewCard({ now }: { now: number }) {
  const { state, setDrawerId } = useWorkspace();
  if (!state) return null;
  const r = dailyReview(state, now);
  const stats: [string, React.ReactNode, string?][] = [
    ["Human", <AnimatedNumber key="h" value={r.human} />, "missions"],
    ["AI", <AnimatedNumber key="a" value={r.ai} />, "missions"],
    ["Time saved", <AnimatedNumber key="s" value={r.savedMinutes} format={fmtDuration} />],
    ["Human leverage", r.leveragePct === null ? "—" : `${r.leveragePct}%`],
    ["Wasted time", fmtDuration(r.wastedMinutes)],
    ["Blocked", String(r.blocked)],
  ];
  return (
    <section>
      <SectionTitle dot="var(--text-3)">Daily review</SectionTitle>
      <div className="card rounded-[26px] p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {stats.map(([k, v, sub]) => (
            <div key={k}>
              <Eyebrow>{k}</Eyebrow>
              <div className={clsx("mt-1 text-[26px] font-semibold tracking-tight", k === "Time saved" && "text-ok", k === "Wasted time" && r.wastedMinutes > 0 && "text-bad")}>{v}</div>
              {sub && <div className="text-[11.5px] text-ink-3">{sub}</div>}
            </div>
          ))}
        </div>
        {r.postponed.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <Eyebrow>Postponed</Eyebrow>
            <ul className="mt-2 flex flex-col gap-1 text-[13px]">
              {r.postponed.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <button onClick={() => setDrawerId(t.id)} className="text-left hover:underline">
                    {t.title} <span className="text-ink-3">· {t.postponedCount}×</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.tomorrow && (
          <div className="mt-5 rounded-2xl bg-hero p-5 text-hero-ink">
            <div className="text-[10.5px] font-bold tracking-[0.16em] text-hero-ink-2 uppercase">Tomorrow’s priority{r.tomorrowProject ? ` · ${r.tomorrowProject.name}` : ""}</div>
            <div className="mt-2 text-[20px] font-semibold tracking-tight">{r.tomorrow.title}</div>
            {r.tomorrow.aiPrep.length > 0 && <div className="mt-1 text-[13px] text-hero-ink-2">AI will prepare: {r.tomorrow.aiPrep.slice(0, 3).join(" + ")}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

/** WEEKLY INTELLIGENCE REPORT */
export function WeeklyReport({ now }: { now: number }) {
  const { state } = useWorkspace();
  if (!state) return null;
  const w = weeklyReview(state, now);
  const rows: [string, string][] = [
    ["Biggest progress", w.biggestProgress ? `${w.biggestProgress.project.name} — ${w.biggestProgress.done} tasks done` : "—"],
    ["Biggest bottleneck", w.bottleneck ? `${w.bottleneck.project.name} — ${w.bottleneck.why}` : "None"],
    ["Most valuable project", w.mostValuable?.name ?? "—"],
    ["Project to pause", w.toPause?.name ?? "None"],
    ["Tasks to automate", w.toAutomate.map((a) => a.label).join(", ") || "None"],
    ["Only you should do", w.onlyYou.map((t) => t.title).join(" · ") || "—"],
    ["Opportunities detected", String(w.opportunities)],
    ["Time saved by AI", fmtDuration(w.savedMinutes)],
    ["Human leverage", w.leveragePct === null ? "—" : `${w.leveragePct}%`],
  ];
  return (
    <section>
      <SectionTitle dot="var(--ai)">Weekly intelligence report</SectionTitle>
      <div className="card rounded-[26px] p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="border-t border-line pt-3">
              <dt className="text-[10.5px] font-bold tracking-[0.12em] text-ink-3 uppercase">{k}</dt>
              <dd className="mt-0.5 text-[13.5px]">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 rounded-2xl bg-hero p-5 text-hero-ink">
          <div className="text-[10.5px] font-bold tracking-[0.16em] text-hero-ink-2 uppercase">Next week’s strategy</div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-[13.5px] sm:grid-cols-5">
            <div>
              <dt className="text-hero-ink-2">Primary</dt>
              <dd className="font-semibold">{w.next.primary?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-hero-ink-2">Secondary</dt>
              <dd className="font-semibold">{w.next.secondary?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-hero-ink-2">Pause</dt>
              <dd className="font-semibold">{w.next.park.map((p) => p.name).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-hero-ink-2">AI focus</dt>
              <dd className="font-semibold">{w.next.aiFocus}</dd>
            </div>
            <div>
              <dt className="text-hero-ink-2">Human focus</dt>
              <dd className="font-semibold">{w.next.humanFocus}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

export function SavedTriplet({ now }: { now: number }) {
  const { state } = useWorkspace();
  if (!state) return null;
  const saved = savedSummary(state, now);
  const vals = [
    ["Today", saved.today.minutes],
    ["This week", saved.week.minutes],
    ["This month", saved.month.minutes],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-4">
      {vals.map(([label, m]) => (
        <div key={label}>
          <div className="text-[11px] font-bold tracking-[0.16em] text-hero-ink-2 uppercase">{label}</div>
          <AnimatedNumber value={m} format={fmtDuration} duration={1.8} className="mt-1 block text-[34px] leading-none font-semibold tracking-tight sm:text-[52px]" />
        </div>
      ))}
    </div>
  );
}
