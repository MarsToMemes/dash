"use client";

import clsx from "clsx";
import { Hourglass, Lightbulb, Sparkles, User } from "lucide-react";
import { motion } from "motion/react";
import { morningBriefing } from "@/lib/planner";
import type { Task } from "@/lib/types";
import { TodayTimeline } from "../home/Sections";
import { DailyReviewCard } from "../intel/Reports";
import { useNow, useWorkspace } from "../store";
import { enter } from "../ui";

/** TODAY — morning briefing, the day's plan, and the evening report. */
export function Today() {
  const now = useNow(1000);
  const { state, setDrawerId } = useWorkspace();
  if (!state) return null;
  const brief = morningBriefing(state, now);

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
          <DailyReviewCard now={now} />
        </motion.div>
      </div>
    </motion.div>
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
