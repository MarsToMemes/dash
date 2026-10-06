"use client";

import { RefreshCw, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AGENT_ORDER } from "@/lib/agents";
import { availableMinutes, fmtDuration, localMinuteOfDay, workforce } from "@/lib/planner";
import { ActivityFeed, TodayTimeline } from "../home/Sections";
import { NextMove } from "../home/NextMove";
import { Workforce } from "../home/Workforce";
import { FocusBanner, MetricTiles, ProjectMomentumList, WhileYouWork } from "../intel/Metrics";
import { ContextBar } from "../intel/Planner";
import { Recommendations } from "../intel/Recommendations";
import { useNow, useWorkspace } from "../store";
import { AgentAvatar, AnimatedNumber, Button, enter } from "../ui";

export function Home() {
  const now = useNow(1000);
  const { thinking } = useWorkspace();
  return (
    <motion.div initial="hidden" animate="show" className="flex flex-col gap-8 pt-6 lg:pt-8">
      {thinking && <div className="scan-line" aria-hidden />}
      <motion.div variants={enter} custom={0}>
        <Hero now={now} />
      </motion.div>
      <DayUpdate now={now} />
      <FocusBanner now={now} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <motion.div variants={enter} custom={1} className="xl:col-span-8">
          <NextMove now={now} />
        </motion.div>
        <motion.div variants={enter} custom={2} className="xl:col-span-4">
          <WhileYouWork />
        </motion.div>
      </div>
      <motion.div variants={enter} custom={3}>
        <MetricTiles now={now} />
      </motion.div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <motion.div variants={enter} custom={4} className="xl:col-span-7">
          <Recommendations now={now} limit={4} />
        </motion.div>
        <motion.div variants={enter} custom={5} className="flex flex-col gap-6 xl:col-span-5">
          <ProjectMomentumList now={now} />
          <ActivityFeed limit={6} />
        </motion.div>
      </div>
      <motion.div variants={enter} custom={6}>
        <Workforce now={now} />
      </motion.div>
      <motion.div variants={enter} custom={7}>
        <TodayTimeline now={now} />
      </motion.div>
    </motion.div>
  );
}

function greeting(minuteOfDay: number) {
  if (minuteOfDay < 12 * 60) return "Good morning";
  if (minuteOfDay < 18 * 60) return "Good afternoon";
  return "Good evening";
}

function Hero({ now }: { now: number }) {
  const { state, whatShouldIDo, thinking } = useWorkspace();
  if (!state) return null;
  const tz = state.settings.tzOffsetMin;
  const wf = workforce(state, now);
  const avail = availableMinutes(state, now);
  const date = new Date(now - tz * 60_000).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const active = new Set(state.jobs.filter((j) => j.status === "RUNNING").map((j) => j.agent));

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="text-[13.5px] text-ink-3">
          {date} · Chief of Staff: <span className="font-semibold text-human">{state.claudeEnabled ? "Claude" : "local heuristics"}</span>
        </div>
        <h1 className="mt-2 text-[44px] leading-[0.98] font-semibold tracking-[-0.035em] sm:text-[64px] lg:text-[76px]">
          {greeting(localMinuteOfDay(now, tz))}, {state.settings.userName}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-ink-2">
          <span>
            <AnimatedNumber value={avail} format={fmtDuration} className="font-semibold text-ink" /> available
          </span>
          <span className="h-1 w-1 rounded-full bg-ink-3" />
          <span>
            <span className="font-semibold text-human">{wf.you.length}</span> only you can do
          </span>
          <span className="h-1 w-1 rounded-full bg-ink-3" />
          <span>
            <span className="font-semibold text-ai">{wf.ai.length}</span> handled by AI
          </span>
        </div>
        <div className="mt-5">
          <ContextBar />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="hidden items-center sm:flex" aria-label="AI agents">
          {AGENT_ORDER.map((role, i) => (
            <motion.span key={role} style={{ marginLeft: i ? -8 : 0, zIndex: 10 - i }} className="relative rounded-full ring-2 ring-app" whileHover={{ y: -3 }}>
              <AgentAvatar role={role} size={36} active={active.has(role)} />
            </motion.span>
          ))}
        </div>
        <Button variant="soft" size="lg" onClick={() => whatShouldIDo()} disabled={thinking !== null} className="ring-1 ring-line">
          {thinking ? <RefreshCw size={16} className="animate-spin text-ai" /> : <Sparkles size={16} className="text-ai" />}
          What should I do?
        </Button>
      </div>
    </div>
  );
}

function DayUpdate({ now }: { now: number }) {
  const { state, act } = useWorkspace();
  const u = state?.settings.dayUpdate;
  const show = u && now - u.at < 30_000;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0, y: -8 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-4 rounded-[22px] bg-ai-soft px-5 py-3.5 ring-1 ring-ai/25">
            <span className="text-[11px] font-extrabold tracking-[0.16em] text-ai uppercase">Day updated</span>
            <span className="min-w-0 flex-1 text-[14px] text-ink">{u.message}</span>
            <button aria-label="Dismiss" onClick={() => act({ type: "dismiss_day_update" })} className="text-ink-3 hover:text-ink">
              <X size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
