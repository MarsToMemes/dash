"use client";

import { motion } from "motion/react";
import { ArbitragePanel, ContextBar, DaySimulator, DecisionLog, TellBox } from "../intel/Planner";
import { Recommendations } from "../intel/Recommendations";
import { FocusBanner } from "../intel/Metrics";
import { useNow } from "../store";
import { enter } from "../ui";

/** STRATEGY — the Mission Optimizer, exposed: arbitrage, simulation, portfolio, memory. */
export function Strategy() {
  const now = useNow(15_000);
  return (
    <motion.div initial="hidden" animate="show" className="flex flex-col gap-8 pt-6 lg:pt-8">
      <motion.div variants={enter} custom={0} className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[13.5px] text-ink-3">Maximum meaningful progress, minimum of your time</div>
          <h1 className="mt-2 text-[44px] leading-none font-semibold tracking-[-0.03em] sm:text-[60px]">Strategy</h1>
        </div>
        <ContextBar />
      </motion.div>
      <FocusBanner now={now} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <motion.div variants={enter} custom={1} className="flex flex-col gap-8 xl:col-span-8">
          <ArbitragePanel now={now} />
          <DaySimulator now={now} />
        </motion.div>
        <motion.div variants={enter} custom={2} className="flex flex-col gap-4 xl:col-span-4">
          <TellBox />
          <DecisionLog now={now} />
        </motion.div>
      </div>
      <motion.div variants={enter} custom={3}>
        <Recommendations now={now} />
      </motion.div>
    </motion.div>
  );
}
