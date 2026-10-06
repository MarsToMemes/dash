"use client";

import clsx from "clsx";
import { Hourglass, Lightbulb, Sparkles, User } from "lucide-react";
import { motion } from "motion/react";
import { dailyReport, fmtDuration, morningBriefing } from "@/lib/planner";
import type { Task } from "@/lib/types";
import { TodayTimeline } from "../home/Sections";
import { useNow, useWorkspace } from "../store";
import { AnimatedNumber, enter, SectionTitle } from "../ui";

/** TODAY — morning briefing, the day's plan, and the evening report. */
export function Today() {
  const now = useNow(1000);
  const { state, setDrawerId } = useWorkspace();
  if (!state) return null;
  const brief = morningBriefing(state, now);
  const report = dailyReport(state, now);

  return (
    <motion.div initial="hidden" animate="show" className="flex flex-col gap-8 pt-6 lg:pt-8">
      <motion.div variants={enter} custom={0}>
        <div className="text-[13.5px] text-ink-3">Morning briefing</div>
        <h1 className="mt-2 max-w-4xl text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] sm:text-[34px]">{brief.headline}</h1>
      </motion.div>

      <motion.div variants={enter} custom={1} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <BriefCol icon={User} tone="text-human" title="You" sub={`${brief.you.length} things only you can do`} tasks={brief.you} onOpen={setDrawerId} />
        <BriefCol icon={Sparkles} tone="text-ai" title="AI" sub={`${brief.ai.length} things the AI will handle`} tasks={brief.ai} onOpen={setDrawerId} />
        <BriefCol icon={Hourglass} tone="text-ink-2" title="Waiting" sub={`${brief.waiting.length} blocked`} tasks={brief.waiting} onOpen={setDrawerId} />
        <div className="card rounded-[24px] p-5">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ai">
            <Lightbulb size={16} /> Opportunities
          </div>
          <div className="mt-0.5 text-[12px] text-ink-3">{brief.opportunities.length} discovered by the AI</div>
          <ul className="mt-4 flex flex-col gap-2.5">
            {brief.opportunities.map((o) => (
              <li key={o.id} className="text-[13.5px] leading-snug">{o.title}</li>
            ))}
            {brief.opportunities.length === 0 && <li className="text-[13px] text-ink-3">Nothing new.</li>}
          </ul>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <motion.div variants={enter} custom={2} className="xl:col-span-7">
          <TodayTimeline now={now} tall />
        </motion.div>
        <motion.div variants={enter} custom={3} className="xl:col-span-5">
          <SectionTitle dot="var(--text-3)">Daily report</SectionTitle>
          <div className="card rounded-[26px] p-6">
            <div className="grid grid-cols-3 gap-4">
              <Stat label="You did" value={report.youDid.length} />
              <Stat label="AI did" value={report.aiDid.length} />
              <div>
                <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">Time saved</div>
                <AnimatedNumber value={report.savedMinutes} format={fmtDuration} className="mt-1 block text-[28px] font-semibold tracking-tight text-ok" />
              </div>
            </div>
            <div className="mt-6 border-t border-line pt-5">
              <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">Still important</div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {report.stillImportant.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => setDrawerId(t.id)} className="text-left text-[14px] hover:underline">{t.title}</button>
                  </li>
                ))}
                {report.stillImportant.length === 0 && <li className="text-[13px] text-ink-3">Nothing high-value left open.</li>}
              </ul>
            </div>
            {report.tomorrow && (
              <div className="mt-6 rounded-2xl bg-hero p-5 text-hero-ink">
                <div className="text-[10.5px] font-bold tracking-[0.16em] text-hero-ink-2 uppercase">Next — your highest-value human action</div>
                <div className="mt-2 text-[20px] font-semibold tracking-tight">{report.tomorrow.title}</div>
                {report.tomorrowPrep.length > 0 && (
                  <div className="mt-2 text-[13px] text-hero-ink-2">AI will prepare: {report.tomorrowPrep.join(" + ")}</div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold tracking-[0.14em] text-ink-3 uppercase">{label}</div>
      <AnimatedNumber value={value} className="mt-1 block text-[28px] font-semibold tracking-tight" />
      <div className="text-[11.5px] text-ink-3">missions</div>
    </div>
  );
}

function BriefCol({
  icon: Icon,
  tone,
  title,
  sub,
  tasks,
  onOpen,
}: {
  icon: typeof User;
  tone: string;
  title: string;
  sub: string;
  tasks: Task[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="card rounded-[24px] p-5">
      <div className={clsx("flex items-center gap-2 text-[13px] font-semibold", tone)}>
        <Icon size={16} /> {title}
      </div>
      <div className="mt-0.5 text-[12px] text-ink-3">{sub}</div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {tasks.map((t) => (
          <li key={t.id}>
            <button onClick={() => onOpen(t.id)} className="text-left text-[13.5px] leading-snug hover:underline">
              {t.title}
            </button>
          </li>
        ))}
        {tasks.length === 0 && <li className="text-[13px] text-ink-3">Nothing here.</li>}
      </ul>
    </div>
  );
}
